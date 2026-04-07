// SPDX-License-Identifier: Apache-2.0

/* eslint-disable prettier/prettier */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-waffle";
import "hardhat-graph";
import { task } from "hardhat/config";
import {
  mintNFT,
  transferERC20,
  createGravatar,
  updateGravatarName,
  transferHtsFT,
  mintHtsNft,
} from "./scripts";
import {
  Client,
  LocalProvider,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  Wallet,
} from "@hashgraph/sdk";

dotenv.config();

task("deployERC20", "Deploys ERC20 contract", async (taskArgs, hre) => {
  const contractName = "ExampleERC20";
  await hre.run("compile");

  const wallet = createWallet(hre);
  const ERC20 = await hre.ethers.getContractFactory(contractName, wallet);
  const contract = await ERC20.deploy(20);

  await contract.deployed();
  const deployTx = await contract.deployTransaction.wait();
  const address = deployTx.contractAddress;

  await hre.run("graph", { contractName, address });
  updateStartBlock(contractName, deployTx.blockNumber, hre);

  console.log("CONTRACT DEPLOYED AT:");
  console.log(address);
});

task(
  "transferERC20",
  "Transfers ERC20 tokens to a recipient",
  async (taskArgs, hre) => {
    await transferERC20(<string>process.env.RECEIVER_PRIVATE_KEY, hre);
  },
);

task("deployERC721", "Deploys ERC721 Contract", async (taskArgs, hre) => {
  const contractName = "ExampleERC721";
  await hre.run("compile");

  const wallet = createWallet(hre);
  const contractArtifacts = await hre.ethers.getContractFactory(
    contractName,
    wallet,
  );
  const contract = await contractArtifacts.deploy();

  await contract.deployed();
  const deployTx = await contract.deployTransaction.wait();
  const address = deployTx.contractAddress;

  await hre.run("graph", { contractName, address });
  updateStartBlock(contractName, deployTx.blockNumber, hre);

  console.log("CONTRACT DEPLOYED AT:");
  console.log(address);
});

task(
  "mintERC721",
  "Mints an ERC721 token to a recipient",
  async (taskArgs, hre) => {
    await mintNFT(<string>process.env.RECEIVER_PRIVATE_KEY, hre);
  },
);

task("deployHTS", "Deploys HTS Fungible Token", async (taskArgs, hre) => {
  const wallet = new Wallet(
    process.env.OPERATOR_ID!,
    process.env.OPERATOR_KEY!,
    new LocalProvider({
      client: Client.forNetwork(JSON.parse(process.env.HEDERA_NETWORK!)),
    }),
  );
  const contractName = "ExampleHTSFT";
  await hre.run("compile");
  let createTransaction = await new TokenCreateTransaction()
    .setTokenName("ffff")
    .setTokenSymbol("F")
    .setDecimals(3)
    .setInitialSupply(0)
    .setTreasuryAccountId(wallet.getAccountId())
    .setAdminKey(wallet.getAccountKey())
    .setFreezeKey(wallet.getAccountKey())
    .setWipeKey(wallet.getAccountKey())
    .setSupplyKey(wallet.getAccountKey())
    .setFreezeDefault(false)
    .freezeWithSigner(wallet);

  createTransaction = await createTransaction.signWithSigner(wallet);
  const resp = await createTransaction.executeWithSigner(wallet);

  const receipt = await resp.getReceiptWithSigner(wallet);
  const address = `0x${receipt.tokenId?.toSolidityAddress()}`;
  console.log(`Created HTS with address: ${address}`);
  let mintTransaction = await new TokenMintTransaction()
    .setAmount(1000)
    .setTokenId(receipt.tokenId!)
    .freezeWithSigner(wallet);
  mintTransaction = await mintTransaction.signWithSigner(wallet);
  await mintTransaction.executeWithSigner(wallet);
  await hre.run("graph", { contractName, address });
  updateStartBlock(contractName, 8, hre);
});

task(
  "deployHTSNFT",
  "Deploys and mint HTS Non Fungible Token",
  async (taskArgs, hre) => {
    const wallet = new Wallet(
      process.env.OPERATOR_ID!,
      process.env.OPERATOR_KEY!,
      new LocalProvider({
        client: Client.forNetwork(JSON.parse(process.env.HEDERA_NETWORK!)),
      }),
    );
    const contractName = "ExampleHTSNFT";
    await hre.run("compile");
    let createTransaction = await new TokenCreateTransaction()
      .setTokenName("NFT Token")
      .setTokenSymbol("NFTT")
      .setTokenType(TokenType.NonFungibleUnique)
      .setDecimals(0)
      .setInitialSupply(0)
      .setMaxSupply(2)
      .setTreasuryAccountId(wallet.getAccountId())
      .setSupplyType(TokenSupplyType.Finite)
      .setAdminKey(wallet.getAccountKey())
      .setSupplyKey(wallet.getAccountKey())
      .freezeWithSigner(wallet);

    createTransaction = await createTransaction.signWithSigner(wallet);
    const resp = await createTransaction.executeWithSigner(wallet);

    const receipt = await resp.getReceiptWithSigner(wallet);
    const address = `0x${receipt.tokenId?.toSolidityAddress()}`;
    console.log(`Created HTS NFT with address: ${address}`);
    let mintTransaction = await new TokenMintTransaction()
      .setTokenId(receipt.tokenId!)
      .setMetadata([Buffer.from("1")])
      .freezeWithSigner(wallet);
    mintTransaction = await mintTransaction.signWithSigner(wallet);
    await mintTransaction.executeWithSigner(wallet);
    await hre.run("graph", { contractName, address });
    updateStartBlock(contractName, 10, hre);
  },
);

task(
  "transferHTSFT",
  "Transfer HTS Fungible Token to a recipient",
  async (taskArgs, hre) => {
    await transferHtsFT(<string>process.env.RECEIVER_PRIVATE_KEY, hre);
  },
);

task(
  "mintNFTHTS",
  "Mints HTS Non Fungible Token to a recipient",
  async (taskArgs, hre) => {
    await mintHtsNft(<string>process.env.RECEIVER_PRIVATE_KEY, hre);
  },
);

task("deployGravatar", "Deploys the passed contract", async (taskArgs, hre) => {
  const contractName = "GravatarRegistry";
  await hre.run("compile");

  const wallet = createWallet(hre);
  const contractArtifacts = await hre.ethers.getContractFactory(
    contractName,
    wallet,
  );
  const contract = await contractArtifacts.deploy();

  await contract.deployed();

  const deployTx = await contract.deployTransaction.wait();
  const address = deployTx.contractAddress;

  await hre.run("graph", { contractName, address });
  updateStartBlock(contractName, deployTx.blockNumber, hre);

  console.log("CONTRACT DEPLOYED AT:");
  console.log(address);
});

task("createGravatar", "Creates a Gravatar")
  .addOptionalParam(
    "signer",
    "The owner of the Gravatar. There can be only one Gravatar per address",
    <string>process.env.OPERATOR_PRIVATE_KEY,
  )
  .addOptionalParam("name", "Gravatar name", "My Gravatar")
  .setAction(async ({ signer, name }, hre) => {
    await createGravatar(
      name,
      `https://example.com/gravatars/${name
        .toLowerCase()
        .replace(" ", "_")}.png`,
      hre,
      signer,
    );
  });

task("updateGravatar", "Creates a Gravatar")
  .addOptionalParam(
    "signer",
    "The owner of the Gravatar. There can be only one Gravatar per address",
    <string>process.env.OPERATOR_PRIVATE_KEY,
  )
  .setAction(async ({ signer }, hre) => {
    await updateGravatarName("My Updated Gravatar", hre, signer);
  });

task("prepare", "Deploys and interacts with contracts", async (_, hre) => {
  console.log("Deploying ERC20!");
  await hre.run("deployERC20");
  console.log("Deploying HTS!");
  await hre.run("deployHTS");
  console.log("Deploying ERC721!");
  await hre.run("deployERC721");
  console.log("Deploying HTS NFT!");
  await hre.run("deployHTSNFT");
  console.log("Deploying Gravatar!");
  await hre.run("deployGravatar");
  console.log("Transferring ERC20!");
  await hre.run("transferERC20");
  console.log("Minting NFT!");
  await hre.run("mintERC721");
  console.log("Creating Gravatar!");
  await hre.run("createGravatar");
});

task("interactWithContracts", "interacts with contracts", async (_, hre) => {
  console.log("Transferring ERC20!");
  await hre.run("transferERC20");
  console.log("Minting NFT!");
  await hre.run("mintERC721");
  console.log("Transfer HTS FT!");
  await hre.run("transferHTSFT");
  console.log("Minting NFT!");
  await hre.run("mintNFTHTS");
  console.log("Updating Existing Gravatar!");
  await hre.run("updateGravatar");
  console.log("Creating Gravatar!");
  await hre.run("createGravatar", {
    signer: process.env.RECEIVER_PRIVATE_KEY,
    name: "Second Gravatar",
  });
});

function updateStartBlock(dataSource: string, startBlock: number, hre: any) {
  const filepath = path.join(__dirname, "subgraph/networks.json");
  const networksRaw = fs.readFileSync(filepath, {
    encoding: "utf-8",
  });
  const networks = JSON.parse(networksRaw);
  networks[hre.network.name][dataSource].startBlock = startBlock || 0;
  fs.writeFileSync(filepath, JSON.stringify(networks, null, 2));
}

function createWallet(hre: any) {
  const provider = new hre.ethers.providers.JsonRpcProvider(
    process.env.RELAY_ENDPOINT,
  );

  return new hre.ethers.Wallet(
    <string>process.env.OPERATOR_PRIVATE_KEY,
    provider,
  );
}

const config = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  defaultNetwork: "local",
  networks: {
    local: {
      url: process.env.RELAY_ENDPOINT,
    },
  },
};

export default config;
