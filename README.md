# Example Solidity TypeScript

## NodeJS

Ensure you have latest [NodeJs LTS](https://nodejs.org/en/) installed and setup to work in the terminal window.

## Project Installation, building and running

Git clone, then from the project root execute

#### Install Node Dependencies

To retrieve the project dependencies and before any further tasks will run correctly

```shell
npm ci
```

#### Build and Test

```shell
npm run build
npm test
```

You can clean too:

```shell
npm run clean
npm run build
npm test
```

### Hardhat

Running directly against hardhat

#### All tests

Target to run all the mocha tests found in the `/test` directory, transpiled as necessary.

```shell
npx hardhat test
```

#### Single test

Run a single test (or a regex of tests), then pass in as an argument.

```shell
 npx hardhat test .\test\sample.test.ts
```

#### Scripts

The TypeScript transpiler will automatically as needed, execute through HardHat for the instantiated environment

```shell
npx hardhat run .\scripts\sample-script.ts
```
