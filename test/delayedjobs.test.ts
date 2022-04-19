// Start - Support direct Mocha run & debug
import 'hardhat'
import '@nomiclabs/hardhat-ethers'
// End - Support direct Mocha run & debug
import chai, {expect} from 'chai'
import {before} from 'mocha'
import {solidity} from 'ethereum-waffle'
import {DelayedJobs} from '../typechain-types'
import {deployContract, signer} from './framework/contracts'
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers'
import {successfulTransaction} from './framework/transaction'
import { Wallet, BigNumber, constants, utils, ethers, providers } from 'ethers'

// Wires up Waffle with Chai
chai.use(solidity)

async function mineBlock(wallet: SignerWithAddress) {
    return wallet.sendTransaction({to: constants.AddressZero, value: 1})
}

async function mineBlocks(wallet: SignerWithAddress, n: number) {
    for (let i = 0; i < n; i++) {
        await mineBlock(wallet)
    }
}

async function increaseTime(wallet: SignerWithAddress, seconds?: number) {
    await (wallet.provider as providers.JsonRpcProvider).send(
        'evm_increaseTime',
        [seconds || 1]
    )
    await mineBlock(wallet)
}

// Start with the contract name as the top level descriptor
describe('DelayedJobs', () => {
    /*
     * Once and before any test, get a handle on the signer and observer
     * (only put variables in before, when their state is not affected by any test)
     */
    before(async () => {
        userA = await signer(0)
        userB = await signer(1)
        reward = utils.parseUnits('1', 'ether') // 1 eth
        signature = 'identity()'
        delay = ethers.BigNumber.from(10000)
        newDelay = ethers.BigNumber.from(20000)
        data = new Uint8Array([]) // ethers.utils.BytesLike.from('')
    })

    // Before each test, deploy a fresh box (clean starting state)
    beforeEach(async () => {
        jobs = await deployContract<DelayedJobs>('DelayedJobs', userA.address, userB.address, delay)
        target = jobs.address
    })

    describe('constructor', () => {
        it('userA', async () => {
            expect(await jobs.userA()).equals(userA.address)
        })

        it('userB', async () => {
            expect(await jobs.userB()).equals(userB.address)
        })
    })

    describe('updateDelay()', () => {
        it('delay updated', async () => {
            const receipt = await successfulTransaction(jobs.updateDelay(newDelay))

            expect(await jobs.delay()).equals(BigNumber.from(20000))
        })

        // Modifier checks contain the flattened and spaced modifier name
        it('only userA', async () => {
            await expect(jobs.connect(userB).updateDelay(newDelay)).to.be.revertedWith(
                'DelayedJobs::updateDelay: Call must come from userA.'
            )
        })
    })

    describe('submitJob()', () => {
        it('not userB', async () => {
            await expect(jobs.connect(userB).submitJob(target, signature, data, {value:reward})).to.be.revertedWith(
                 'DelayedJobs::submitJob: Call must come from userA.'
            )
        })

        it('userA ok', async () => {
            const receipt = await successfulTransaction(jobs.connect(userA).submitJob(target, signature, data, {value:reward}))
            expect(receipt.logs.length).equals(1)
        })
    })

    describe('executeJob()', () => {
        it('not userA', async () => {
            await expect(jobs.connect(userA).executeJob(target, reward, signature, data)).to.be.revertedWith(
                 'DelayedJobs::executeJob: Call must come from userB.'
            )
        })

        it('userB gets reward', async () => {
            const receipt = await successfulTransaction(jobs.connect(userA).submitJob(target, signature, data, {value:reward}))
            expect(receipt.logs.length).equals(1)
            await increaseTime(userB, delay.toNumber())
            const initBalance = await userB.getBalance()
            const receipt2 = await successfulTransaction(jobs.connect(userB).executeJob(target, reward, signature, data))
            expect(receipt2.logs.length).equals(1)
            // userB gets rewards 1 ether, minus gas consumed.
            expect((await userB.getBalance()).gte( initBalance.add(reward).sub(BigNumber.from('47780257489784')) )).equals(true)
        })
    })


    let userA: SignerWithAddress
    let userB: SignerWithAddress
    let delay: ethers.BigNumber
    let jobs: DelayedJobs
    let reward: ethers.BigNumber
    let signature: string
    let newDelay: ethers.BigNumber
    let data: Uint8Array
    let target: string
    let eta: ethers.BigNumber
})
