-- Charm rules: add 'ends_in_whole' strategy.
--
-- Existing strategies (ends_in, round_to, fixed_offset) all operate on
-- the cents/decimal portion or as a multiple — there's no way to say
-- "I want the price to end in 9 / 99 / 95 quetzales." This adds a new
-- strategy that snaps the integer portion to a configured tail.
--
-- Value semantics for ends_in_whole: a non-negative integer N. The rule
-- snaps the price up to the smallest integer ≥ price whose last
-- digit-count(N) digits equal N, with cents cleared to .00.

ALTER TABLE charm_rule DROP CONSTRAINT IF EXISTS charm_rule_strategy_check;
ALTER TABLE charm_rule
  ADD CONSTRAINT charm_rule_strategy_check
    CHECK (strategy IN ('ends_in', 'round_to', 'fixed_offset', 'ends_in_whole'));

INSERT INTO scout_schema_version (version, description)
VALUES ('20260510000023',
        'charm_rule.strategy: add ends_in_whole (snap integer portion to a configured tail)');
