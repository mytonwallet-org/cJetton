import { Address, beginCell, Dictionary, toNano } from '@ton/core';
import { compile, NetworkProvider } from '@ton/blueprint';
import { jettonWalletCodeFromLibrary, promptUrl, promptUserFriendlyAddress } from '../wrappers/ui-utils';

import '@ton/test-utils';
import { jettonContentToCell, JettonMinter } from '../wrappers/JettonMinter';
import { buff2bigint} from '../sandbox_tests/utils';
import { airDropValue } from './generateTestJetton';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse';
import fs from 'fs';

const AIRDROP_START = Math.round(Date.now() / 1000);
const AIRDROP_END   = AIRDROP_START + 2592000; // +1 month
const CSV_FILENAME = 'data/airdrop.csv';
const BOC_FILENAME = 'data/airdropData.boc';

interface Participant {
    name: string;
    address: string;
    amount: string;
}

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const { merkleRoot, totalSupply } = await prepareAirdropData();

    const ui = provider.ui();
    const adminAddress = await promptUserFriendlyAddress('Enter the address of the jetton owner (admin):', ui, isTestnet);
    const jettonMetadataUri = await promptUrl('Enter jetton metadata uri (https://jettonowner.com/jetton.json)', ui)

    const wallet_code_raw = await compile('JettonWallet');
    const wallet_code = jettonWalletCodeFromLibrary(wallet_code_raw);
    const minter_code = await compile('JettonMinter');

    const minterContract = JettonMinter.createFromFullConfig({
        admin: adminAddress.address,
        wallet_code: wallet_code,
        merkle_root: merkleRoot,
        jetton_content: jettonContentToCell({ uri: jettonMetadataUri }),
        supply: totalSupply,
        transfer_admin: null,
    }, minter_code);

    const minter = provider.open(minterContract);
    await minter.sendDeploy(provider.sender(), toNano('1.5'));

    console.log('Minter deployed at address: ', minter.address.toString());
}

export async function prepareAirdropData() {
    let totalSupply = 0n;
    let airdropData = Dictionary.empty(Dictionary.Keys.Address(), airDropValue);
    const participants = await readCsv<Participant>(CSV_FILENAME);

    for (const { amount, address, name} of participants) {
        const jettonAmount = toNano(amount);
        totalSupply += jettonAmount;

        airdropData.set(Address.parse(address), {
            amount: jettonAmount,
            start_from: AIRDROP_START,
            expire_at: AIRDROP_END,
        });
    }

    const airdropCell   = beginCell().storeDictDirect(airdropData).endCell();
    const merkleRoot    = buff2bigint(airdropCell.hash(0));
    const serializedAirdropCell = airdropCell.toBoc();
    fs.writeFileSync(BOC_FILENAME, serializedAirdropCell);

    return { merkleRoot, airdropData, totalSupply };
}

function readCsv<T>(filename: string): Promise<T[]> {
    const csvFilePath = path.resolve(__dirname, '../', filename);
    const results: T[] = [];

    return new Promise((resolve, reject) => {
        fs.createReadStream(csvFilePath)
          .pipe(parseCsv({ columns: true }))
          .on('data', (data: object) => results.push(data as T))
          .on('end', () => {
              resolve(results);
          })
          .on('error', (error: any) => {
              reject(`Ошибка при чтении CSV файла: ${error.message}`);
          });
    });
}
