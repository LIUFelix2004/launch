use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("AtH8XVVKMm51FKPhYgYkw4ZVXb2fb8nnXjNumyTP44fo");

const LAUNCH_FEE_LAMPORTS: u64 = 100_000_000;
const FLOOR_RESERVE_LAMPORTS: u64 = 49_000_000;
const LIQUIDITY_RESERVE_LAMPORTS: u64 = 49_000_000;
const PROTOCOL_FEE_LAMPORTS: u64 = 1_250_000;
const POOL_TOTAL_LAMPORTS: u64 = LAUNCH_FEE_LAMPORTS - PROTOCOL_FEE_LAMPORTS;
const TRADE_FEE_BPS: u64 = 125;
const BPS_DENOMINATOR: u64 = 10_000;
const FEE_PROTOCOL_BPS: u64 = 3_000;
const FEE_FLOOR_BPS: u64 = 4_000;
const FEE_CREATOR_BPS: u64 = 3_000;

#[program]
pub mod rise_launchpad {
    use super::*;

    pub fn create_launch(ctx: Context<CreateLaunch>, metadata: TokenMetadata, supply: u64) -> Result<()> {
        require!(supply > 0, LaunchError::InvalidSupply);

        let pool = &mut ctx.accounts.pool;
        pool.creator = ctx.accounts.creator.key();
        pool.mint = ctx.accounts.mint.key();
        pool.floor_sol = FLOOR_RESERVE_LAMPORTS;
        pool.liq_sol = LIQUIDITY_RESERVE_LAMPORTS;
        pool.protocol_fee_sol = PROTOCOL_FEE_LAMPORTS;
        pool.total_sol = POOL_TOTAL_LAMPORTS;
        pool.supply = supply;
        pool.sold_supply = 0;
        pool.trade_fee_bps = TRADE_FEE_BPS;
        pool.protocol_fee_bps = FEE_PROTOCOL_BPS;
        pool.floor_fee_bps = FEE_FLOOR_BPS;
        pool.creator_fee_bps = FEE_CREATOR_BPS;
        pool.slope_numerator = metadata.slope_numerator;
        pool.slope_denominator = metadata.slope_denominator;
        pool.initial_price_numerator = metadata.initial_price_numerator;
        pool.initial_price_denominator = metadata.initial_price_denominator;
        validate_curve(pool)?;
        pool.floor_price = 0;
        pool.ath_price = marginal_price_at_sold(pool, 0)?;
        pool.bump = ctx.bumps.pool;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: pool.to_account_info(),
                },
            ),
            POOL_TOTAL_LAMPORTS,
        )?;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.protocol_treasury.to_account_info(),
                },
            ),
            PROTOCOL_FEE_LAMPORTS,
        )?;

        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_out: u64, direction: SwapDirection) -> Result<()> {
        require!(amount_in > 0, LaunchError::InvalidAmount);

        match direction {
            SwapDirection::Buy => {
                let quote = {
                    let pool = &ctx.accounts.pool;
                    validate_curve(pool)?;
                    quote_linear_buy(pool, amount_in)?
                };
                let out = quote.destination_amount;
                require!(out >= min_out, LaunchError::SlippageExceeded);

                transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.trader.to_account_info(),
                            to: ctx.accounts.pool.to_account_info(),
                        },
                    ),
                    amount_in,
                )?;

                let creator_key = ctx.accounts.pool.creator;
                let mint_key = ctx.accounts.pool.mint;
                let signer_seeds: &[&[&[u8]]] = &[&[
                    b"pool",
                    creator_key.as_ref(),
                    mint_key.as_ref(),
                    &[ctx.accounts.pool.bump],
                ]];

                token::mint_to(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        MintTo {
                            mint: ctx.accounts.mint.to_account_info(),
                            to: ctx.accounts.trader_token_account.to_account_info(),
                            authority: ctx.accounts.pool.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    out,
                )?;

                let pool = &mut ctx.accounts.pool;
                pool.sold_supply = pool.sold_supply.checked_add(out).ok_or(LaunchError::MathOverflow)?;
                pool.liq_sol = pool
                    .liq_sol
                    .checked_add(quote.net_amount)
                    .and_then(|v| v.checked_add(quote.floor_injection))
                    .ok_or(LaunchError::MathOverflow)?;
                pool.floor_sol = pool.floor_sol.checked_add(quote.floor_injection).ok_or(LaunchError::MathOverflow)?;
                pool.protocol_fee_sol = pool.protocol_fee_sol.checked_add(quote.protocol_fee).ok_or(LaunchError::MathOverflow)?;
                pool.creator_fee_sol = pool.creator_fee_sol.checked_add(quote.creator_fee).ok_or(LaunchError::MathOverflow)?;
                update_ath_and_floor(pool)?;
            }
            SwapDirection::Sell => {
                let (quote, next_liq) = {
                    let pool = &ctx.accounts.pool;
                    validate_curve(pool)?;
                    let quote = quote_linear_sell(pool, amount_in)?;
                    let next_liq = pool.liq_sol.checked_sub(quote.destination_amount).ok_or(LaunchError::FloorGuard)?;
                    require!(next_liq >= pool.floor_sol.saturating_mul(110) / 100, LaunchError::FloorGuard);
                    (quote, next_liq)
                };
                let out = quote.destination_amount;
                require!(out >= min_out, LaunchError::SlippageExceeded);

                token::burn(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Burn {
                            mint: ctx.accounts.mint.to_account_info(),
                            from: ctx.accounts.trader_token_account.to_account_info(),
                            authority: ctx.accounts.trader.to_account_info(),
                        },
                    ),
                    amount_in,
                )?;

                let pool_info = ctx.accounts.pool.to_account_info();
                let trader_info = ctx.accounts.trader.to_account_info();
                let rent_floor = Rent::get()?.minimum_balance(8 + TokenPool::INIT_SPACE);
                let pool_lamports = **pool_info.lamports.borrow();
                let trader_lamports = trader_info.lamports();
                require!(
                    pool_lamports >= out.checked_add(rent_floor).ok_or(LaunchError::MathOverflow)?,
                    LaunchError::InsufficientPoolLamports
                );
                **pool_info.try_borrow_mut_lamports()? = pool_lamports.checked_sub(out).ok_or(LaunchError::MathOverflow)?;
                **trader_info.try_borrow_mut_lamports()? = trader_lamports.checked_add(out).ok_or(LaunchError::MathOverflow)?;

                let pool = &mut ctx.accounts.pool;
                pool.sold_supply = pool.sold_supply.checked_sub(amount_in).ok_or(LaunchError::MathOverflow)?;
                pool.liq_sol = next_liq;
                pool.floor_sol = pool.floor_sol.checked_add(quote.floor_injection).ok_or(LaunchError::MathOverflow)?;
                pool.protocol_fee_sol = pool.protocol_fee_sol.checked_add(quote.protocol_fee).ok_or(LaunchError::MathOverflow)?;
                pool.creator_fee_sol = pool.creator_fee_sol.checked_add(quote.creator_fee).ok_or(LaunchError::MathOverflow)?;
                update_ath_and_floor(pool)?;
            }
        }

        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SwapQuote {
    pub source_amount: u64,
    pub net_amount: u64,
    pub destination_amount: u64,
    pub trade_fee: u64,
    pub protocol_fee: u64,
    pub floor_injection: u64,
    pub creator_fee: u64,
    pub next_sold_supply: u64,
}

fn validate_curve(pool: &TokenPool) -> Result<()> {
    require!(pool.slope_numerator > 0, LaunchError::InvalidCurve);
    require!(pool.slope_denominator > 0, LaunchError::InvalidCurve);
    require!(pool.initial_price_denominator > 0, LaunchError::InvalidCurve);
    require!(
        pool.protocol_fee_bps
            .checked_add(pool.floor_fee_bps)
            .and_then(|v| v.checked_add(pool.creator_fee_bps))
            .ok_or(LaunchError::MathOverflow)?
            == BPS_DENOMINATOR,
        LaunchError::InvalidFeeSplit
    );
    Ok(())
}

fn split_fee(pool: &TokenPool, amount: u64) -> Result<(u64, u64, u64, u64, u64)> {
    let trade_fee = amount
        .checked_mul(pool.trade_fee_bps)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(LaunchError::MathOverflow)?;
    let net_amount = amount.checked_sub(trade_fee).ok_or(LaunchError::MathOverflow)?;
    let protocol_fee = trade_fee
        .checked_mul(pool.protocol_fee_bps)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(LaunchError::MathOverflow)?;
    let floor_injection = trade_fee
        .checked_mul(pool.floor_fee_bps)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(LaunchError::MathOverflow)?;
    let creator_fee = trade_fee
        .checked_sub(protocol_fee)
        .and_then(|v| v.checked_sub(floor_injection))
        .ok_or(LaunchError::MathOverflow)?;
    Ok((trade_fee, net_amount, protocol_fee, floor_injection, creator_fee))
}

fn collateral_at_sold(pool: &TokenPool, sold_tokens: u64) -> Result<u128> {
    let sold = sold_tokens as u128;
    let quadratic = (pool.slope_numerator as u128)
        .checked_mul(sold)
        .and_then(|v| v.checked_mul(sold))
        .and_then(|v| v.checked_div(2u128.checked_mul(pool.slope_denominator as u128)?))
        .ok_or(LaunchError::MathOverflow)?;
    let linear = (pool.initial_price_numerator as u128)
        .checked_mul(sold)
        .and_then(|v| v.checked_div(pool.initial_price_denominator as u128))
        .ok_or(LaunchError::MathOverflow)?;
    quadratic.checked_add(linear).ok_or(LaunchError::MathOverflow.into())
}

fn marginal_price_at_sold(pool: &TokenPool, sold_tokens: u64) -> Result<u64> {
    let slope_component = (pool.slope_numerator as u128)
        .checked_mul(sold_tokens as u128)
        .and_then(|v| v.checked_div(pool.slope_denominator as u128))
        .ok_or(LaunchError::MathOverflow)?;
    let initial_component = (pool.initial_price_numerator as u128)
        .checked_div(pool.initial_price_denominator as u128)
        .ok_or(LaunchError::MathOverflow)?;
    slope_component
        .checked_add(initial_component)
        .and_then(|v| v.try_into().ok())
        .ok_or(LaunchError::MathOverflow.into())
}

fn sold_at_collateral(pool: &TokenPool, target_collateral: u128) -> Result<u64> {
    let mut lo = 0u64;
    let mut hi = pool.supply;
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if collateral_at_sold(pool, mid)? <= target_collateral {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    Ok(lo)
}

fn quote_linear_buy(pool: &TokenPool, sol_in: u64) -> Result<SwapQuote> {
    let (trade_fee, net_amount, protocol_fee, floor_injection, creator_fee) = split_fee(pool, sol_in)?;
    let start_collateral = collateral_at_sold(pool, pool.sold_supply)?;
    let target_collateral = start_collateral
        .checked_add(net_amount as u128)
        .ok_or(LaunchError::MathOverflow)?;
    let end_sold = sold_at_collateral(pool, target_collateral)?;
    let remaining = pool.supply.checked_sub(pool.sold_supply).ok_or(LaunchError::MathOverflow)?;
    let destination_amount = end_sold.saturating_sub(pool.sold_supply).min(remaining);
    Ok(SwapQuote {
        source_amount: sol_in,
        net_amount,
        destination_amount,
        trade_fee,
        protocol_fee,
        floor_injection,
        creator_fee,
        next_sold_supply: pool.sold_supply.saturating_add(destination_amount),
    })
}

fn quote_linear_sell(pool: &TokenPool, token_in: u64) -> Result<SwapQuote> {
    require!(token_in <= pool.sold_supply, LaunchError::InvalidAmount);
    let start_collateral = collateral_at_sold(pool, pool.sold_supply)?;
    let next_sold_supply = pool.sold_supply.checked_sub(token_in).ok_or(LaunchError::MathOverflow)?;
    let end_collateral = collateral_at_sold(pool, next_sold_supply)?;
    let curve_out: u64 = start_collateral
        .checked_sub(end_collateral)
        .and_then(|v| v.try_into().ok())
        .ok_or(LaunchError::MathOverflow)?;
    let floor_out = (token_in as u128)
        .checked_mul(pool.floor_price as u128)
        .and_then(|v| v.try_into().ok())
        .ok_or(LaunchError::MathOverflow)?;
    let gross_out = curve_out.max(floor_out);
    let (trade_fee, net_amount, protocol_fee, floor_injection, creator_fee) = split_fee(pool, gross_out)?;
    Ok(SwapQuote {
        source_amount: token_in,
        net_amount: token_in,
        destination_amount: net_amount,
        trade_fee,
        protocol_fee,
        floor_injection,
        creator_fee,
        next_sold_supply,
    })
}

fn update_ath_and_floor(pool: &mut TokenPool) -> Result<()> {
    let spot = marginal_price_at_sold(pool, pool.sold_supply)?;
    if spot > pool.ath_price {
        pool.ath_price = spot;
    }

    if pool.sold_supply == 0 {
        return Ok(());
    }

    let half_ath = pool.ath_price / 2;
    let backed_floor = pool.floor_sol / pool.sold_supply.max(1);
    let next_floor = half_ath.min(backed_floor);
    if next_floor > pool.floor_price {
        pool.floor_price = next_floor;
    }
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenMetadata {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub slope_numerator: u64,
    pub slope_denominator: u64,
    pub initial_price_numerator: u64,
    pub initial_price_denominator: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SwapDirection {
    Buy,
    Sell,
}

#[derive(Accounts)]
#[instruction(metadata: TokenMetadata)]
pub struct CreateLaunch<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + TokenPool::INIT_SPACE,
        seeds = [b"pool", creator.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, TokenPool>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: The mint account is created and initialized by the client in the
    /// same transaction. Create only stores the pubkey; swap validates it as a
    /// real SPL Mint before any mint/burn CPI.
    #[account(mut)]
    pub mint: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(mut)]
    /// CHECK: Receives the fixed protocol launch fee. It does not need to be
    /// deserialized by this instruction.
    pub protocol_treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut, has_one = mint)]
    pub pool: Account<'info, TokenPool>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(
        mut,
        constraint = trader_token_account.mint == mint.key() @ LaunchError::InvalidTokenAccount,
        constraint = trader_token_account.owner == trader.key() @ LaunchError::InvalidTokenAccount
    )]
    pub trader_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct TokenPool {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub floor_sol: u64,
    pub liq_sol: u64,
    pub protocol_fee_sol: u64,
    pub creator_fee_sol: u64,
    pub total_sol: u64,
    pub floor_price: u64,
    pub ath_price: u64,
    pub supply: u64,
    pub sold_supply: u64,
    pub trade_fee_bps: u64,
    pub protocol_fee_bps: u64,
    pub floor_fee_bps: u64,
    pub creator_fee_bps: u64,
    pub slope_numerator: u64,
    pub slope_denominator: u64,
    pub initial_price_numerator: u64,
    pub initial_price_denominator: u64,
    pub bump: u8,
}

#[error_code]
pub enum LaunchError {
    #[msg("Invalid supply")]
    InvalidSupply,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Floor reserve guard rejected the trade")]
    FloorGuard,
    #[msg("Invalid curve")]
    InvalidCurve,
    #[msg("Invalid fee split")]
    InvalidFeeSplit,
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    #[msg("Pool lamports are insufficient for this settlement")]
    InsufficientPoolLamports,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_pool() -> TokenPool {
        TokenPool {
            creator: Pubkey::default(),
            mint: Pubkey::default(),
            floor_sol: FLOOR_RESERVE_LAMPORTS,
            liq_sol: LIQUIDITY_RESERVE_LAMPORTS,
            protocol_fee_sol: PROTOCOL_FEE_LAMPORTS,
            creator_fee_sol: 0,
            total_sol: LAUNCH_FEE_LAMPORTS - PROTOCOL_FEE_LAMPORTS,
            floor_price: 0,
            ath_price: 0,
            supply: 1_000_000_000_000_000,
            sold_supply: 0,
            trade_fee_bps: TRADE_FEE_BPS,
            protocol_fee_bps: FEE_PROTOCOL_BPS,
            floor_fee_bps: FEE_FLOOR_BPS,
            creator_fee_bps: FEE_CREATOR_BPS,
            slope_numerator: 37,
            slope_denominator: 1_400_000_000_000_000_000,
            initial_price_numerator: 7,
            initial_price_denominator: 2,
            bump: 255,
        }
    }

    #[test]
    fn collateral_inverse_round_trips_inside_integer_precision() {
        let pool = test_pool();
        let sold = 285_713_513_513;
        let collateral = collateral_at_sold(&pool, sold).unwrap();
        let solved = sold_at_collateral(&pool, collateral).unwrap();
        assert!(solved <= sold);
        assert!(sold - solved < 10_000);
    }

    #[test]
    fn buy_quote_matches_fee_split() {
        let pool = test_pool();
        let quote = quote_linear_buy(&pool, 1_000_000_000).unwrap();
        assert_eq!(quote.trade_fee, 12_500_000);
        assert_eq!(quote.protocol_fee, 3_750_000);
        assert_eq!(quote.floor_injection, 5_000_000);
        assert_eq!(quote.creator_fee, 3_750_000);
        assert!(quote.destination_amount > 0);
    }

    #[test]
    fn sell_quote_charges_fee_on_sol_output() {
        let mut pool = test_pool();
        let buy = quote_linear_buy(&pool, 1_000_000_000).unwrap();
        pool.sold_supply = buy.destination_amount;
        pool.liq_sol = pool.liq_sol + buy.net_amount + buy.floor_injection;

        let sell = quote_linear_sell(&pool, buy.destination_amount / 2).unwrap();
        assert!(sell.destination_amount > 0);
        assert!(sell.trade_fee > 0);
        assert!(sell.next_sold_supply < pool.sold_supply);
    }
}
