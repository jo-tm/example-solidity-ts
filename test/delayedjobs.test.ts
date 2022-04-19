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

const oneWeekInSeconds = 7 * 24 * 60 * 60 // etherUnsigned(7 * 24 * 60 * 60);

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

    describe('submitJobAuction()', () => {
        it('not userB', async () => {
            const timeout = BigNumber.from(3601)
            await expect(jobs.connect(userB).submitJobAuction(target, signature, data, timeout, {value:reward})).to.be.revertedWith(
                 'DelayedJobs::submitJobAuction: Call must come from userA.'
            )
        })

        it('timeout too small', async () => {
            const timeout = BigNumber.from(3600)
            await expect(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward})).to.be.revertedWith(
                 'DelayedJobs::submitJobAuction: Timeout must be great than 1 hour'
            )
        })

        it('userA ok', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
        })
    })

    describe('placeJobBid()', () => {
        it('not userA', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userA).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.revertedWith(
                 'DelayedJobs::placeJobBid: Call must not come from userA.'
            )
        })

        it('bid too large', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            const bid = reward
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.revertedWith(
                 'DelayedJobs::placeJobBid: Bid must be positive and smaller than best bid'
            )
        })
        it('too late after delay', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            await increaseTime(userB, delay.toNumber())
            const bid = reward
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.revertedWith(
                 'DelayedJobs::placeJobBid: Transaction cannot surpass delay time.'
            )
        })
        it('unsubmitted tx', async () => {
            const timeout = BigNumber.from(3601)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.revertedWith(
                 'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            )
        })
        it('good bid', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            //await increaseTime(userB, delay.toNumber() - 1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            // const receipt2 = await successfulTransaction(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff}))
            // expect(receipt2.logs.length).equals(1)
        })
    })

    describe('executeJobBid()', () => {
        it('not userA', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            //await increaseTime(userB, delay.toNumber() - 1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber() + 1)
            await expect(jobs.connect(userA).executeJobBid(target, reward, signature, data, timeout)).to.be.revertedWith(
                'DelayedJobs::executeJobBid: Call must not come from userA.'
           )
        })
        it('too late', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            //await increaseTime(userB, delay.toNumber() - 1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber() + timeout.toNumber() + 1)
            await expect(jobs.connect(userB).executeJobBid(target, reward, signature, data, timeout)).to.be.revertedWith(
                'DelayedJobs::executeJobBid: Transaction has surpassed delay+timeout time.'
           )
        })
        it('too early', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            //await increaseTime(userB, delay.toNumber() - 1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber() - 100)
            await expect(jobs.connect(userB).executeJobBid(target, reward, signature, data, timeout)).to.be.revertedWith(
                'DelayedJobs::executeJobBid: Transaction has not surpassed delay time.'
           )
        })
        it('execution', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber() + 1)
            await expect(jobs.connect(userB).executeJobBid(target, reward, signature, data, timeout)).to.be.not.revertedWith(
                'DelayedJobs::executeJobBid: Transaction execution reverted.'
           )
        })
    })

    describe('cancelJobAuction()', () => {
        it('only userA', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            //await increaseTime(userB, delay.toNumber() - 1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber() + 1)
            await expect(jobs.connect(userB).cancelJobAuction(target, reward, signature, data, timeout)).to.be.revertedWith(
                'DelayedJobs::submitJobAuction: Call must come from userA.'
           )
        })
        it('too early', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            //await increaseTime(userB, delay.toNumber() - 1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber())
            await expect(jobs.connect(userA).cancelJobAuction(target, reward, signature, data, timeout)).to.be.revertedWith(
                'DelayedJobs::cancelJobAuction: Cancelling only after delay+timeout'
           )
        })
        it('cancelled', async () => {
            const timeout = BigNumber.from(3601)
            const receipt = await successfulTransaction(jobs.connect(userA).submitJobAuction(target, signature, data, timeout, {value:reward}))
            expect(receipt.logs.length).equals(1)
            const bid = reward.sub(utils.parseUnits('10', 'gwei'))
            const diff = reward.sub(bid)
            await expect(jobs.connect(userB).placeJobBid(target, reward, bid, signature, data, timeout, {value:diff})).to.be.not.revertedWith(
                'DelayedJobs::placeJobBid: Transaction has not been submitted.'
            ) 
            await increaseTime(userB, delay.toNumber() + timeout.toNumber() + 1)
            await expect(jobs.connect(userA).cancelJobAuction(target, reward, signature, data, timeout)).to.be.not.revertedWith(
                'DelayedJobs::executeJobBid: Transaction execution reverted.'
            )
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
