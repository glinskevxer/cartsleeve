# cartsleeve

Music rotation scheduling, log finalisation and performance royalty reporting
for a small commercial radio group.

Stations carry a library of carts sorted into rotation categories, a set of hour
clocks that say what airs where, a traffic log of commercials sold against
inventory, and an obligation to report every performance they broadcast.
cartsleeve turns those four things into a music log, merges the traffic into it,
reconciles the result against what the automation says actually aired, and files
the performance report.

## Why it is not a playlist tool

A playlist is a list. A music log is the output of a constraint search over a
rotating library, and most of the rules in it measure something another rule
produced.

- daypart restriction decides what turnover measures
- rest ordering decides which separation rule is the one that fires
- a substitution moves the artist distance available in every later slot
- selling one more spot into an hour moves separation without moving song order
- a featured credit is one play to the separation rules and several to royalty

## Layout

    src/util      dates, ids, durations, delimited files, tables
    src/domain    stations, dayparts, categories, carts, clocks
    src/library   carding, attribute coding, import, validation
    src/rotation  rest, order, packets, turnover, balance
    src/rules     separation, flow, eligibility, tiers
    src/schedule  candidate search, hour and day passes, breaches, holes
    src/traffic   spots, stopsets, spot load, the merge
    src/aired     automation events, the as aired rebuild, reconciliation
    src/royalty   spins, credit splits, the performance report
    src/store     journal, snapshots, the indexed table
    src/service   station, scheduling and reporting operations
    src/report    turnover, breach and rotation health reports
    src/api       request envelope and handlers
    src/cli       the command line

Tests live under `tests/` and mirror `src/`.

## Running it

    npm ci
    npm run typecheck
    npm run lint
    npm run test
    npm run build

`npm run verify-tree` enforces the layering. An import that points up the stack,
or a module with no test of its own, fails its own CI job.

    src/report   sits below traffic, aired and royalty, not above them

Printing is a pure function from values to lines. Putting it at the top of the
stack would have forced a second copy of the page frame into the royalty filing,
which is the duplication the frame exists to remove.

## Requirements

Node 22.13 or newer on the 22 line. The only runtime dependencies are
`commander` and `zod`, so there is nothing to compile and no native module.
