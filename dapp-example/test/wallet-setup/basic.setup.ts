import { defineWalletSetup } from '@synthetixio/synpress';
import { MetaMask } from '@synthetixio/synpress/playwright';
import 'dotenv/config';

const SEED_PHRASE = process.env.SEED_PHRASE || 'test test test test test test test test test test test junk';
const PASSWORD = process.env.WALLET_PASSWORD || 'Tester@1234';

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD);
  await metamask.importWallet(SEED_PHRASE);
});
