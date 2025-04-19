# Layer Zero examples

### OApp

Message-passing interface to send and receive arbitrary pieces of data between contracts existing on different chains.

- Deploying the oapp contract on each network we're going to interact
```typescript
npx hardhat deploy-oapp --network hedera_testnet
npx hardhat deploy-oapp --network bsc_testnet
```

- In order to connect oapps together, we need to set the peer of the target oapp, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_oapp_address> --target <bsc_oapp_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_oapp_address> --target <hedera_oapp_address> --network bsc_testnet
```

- Fill the .env

- On these steps, we're sending messages from one chain to another and vice versa
```typescript
npx hardhat test --grep "OAppTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "OAppTests @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

- Finally we're checking whether the messages are received on both chains
```typescript
npx hardhat test --grep "OAppTests @hedera @test" --network hedera_testnet
npx hardhat test --grep "OAppTests @bsc @test" --network bsc_testnet
```

### OFT

Allows fungible tokens to be transferred across multiple chains.

- Deploying OFT tokens which under the hood are ERC20s and contain the messaging between chains functionality provided by LZ
```typescript
npx hardhat deploy-oft --decimals 18 --mint 1000000000000000000 --network hedera_testnet
npx hardhat deploy-oft --decimals 18 --mint 1000000000000000000 --network bsc_testnet
```

- In order to connect OFTs together, we need to set the peer of the target OFT, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_oft_address> --target <bsc_oft_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_oft_address> --target <hedera_oft_address> --network bsc_testnet
```

- Fill the .env

- On these steps, we're sending tokens between chains. That means we're burning tokens on the source chain and minting new ones on the destination chain
```typescript
npx hardhat test --grep "OFTTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "OFTTests @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

- Finally we're checking whether the token balances are as expected on both the source and destination chains.
```typescript
npx hardhat test --grep "OFTTests @hedera @test" --network hedera_testnet
npx hardhat test --grep "OFTTests @bsc @test" --network bsc_testnet
```

### OFT Adapter

If your token already exists on the chain you want to connect, you can deploy the OFT Adapter contract to act as an intermediary lockbox for the token.

- Deploying ERC20 tokens on each chain
```typescript
npx hardhat deploy-erc20 --decimals 18 --mint 10000000000000000000 --network hedera_testnet
npx hardhat deploy-erc20 --decimals 18 --mint 10000000000000000000 --network bsc_testnet
```

- Deploying an OFT Adapters which will be used as a lockbox of ERC20s deployed the step above, you can use an already existing HTS token as well
```typescript
npx hardhat deploy-oft-adapter --token <erc20_hedera_address> --network hedera_testnet
npx hardhat deploy-oft-adapter --token <erc20_bsc_address> --network bsc_testnet
```

- In order to connect OFT Adapters together, we need to set the peer of the target OFT Adapter, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_oft_adapter_address> --target <bsc_oft_adapter_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_oft_adapter_address> --target <hedera_oft_adapter_address> --network bsc_testnet
```

- Fill the .env

- Here we're funding the Adapter on both chains with some liquidity and after that we're approving it to spend the signer's token
```typescript
npx hardhat test --grep "OFTAdapterTests @hedera @fund-and-approve" --network hedera_testnet
npx hardhat test --grep "OFTAdapterTests @bsc @fund-and-approve" --network bsc_testnet
```

- On these steps, we're sending already existing tokens that are used by OFT Adapter between different chains
```typescript
npx hardhat test --grep "OFTAdapterTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "OFTAdapterTests @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

- Finally we're checking the balances on each chain
```typescript
npx hardhat test --grep "OFTAdapterTests @hedera @test" --network hedera_testnet
npx hardhat test --grep "OFTAdapterTests @bsc @test" --network bsc_testnet
```

### ONFT

Allows non-fungible tokens to be transferred across multiple chains.

- Deploying ONFT tokens which under the hood are ERC721s and contain the messaging between chains functionality provided by LZ
```typescript
npx hardhat deploy-onft --network hedera_testnet
npx hardhat deploy-onft --network bsc_testnet
```

- In order to connect ONFTs together, we need to set the peer of the target ONFT, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_onft_address> --target <bsc_onft_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_onft_address> --target <hedera_onft_address> --network bsc_testnet
```

- Fill the .env

- On these steps, we're sending NFTs between chains. That means we're burning the NFT on the source chain and minting new one on the destination chain
```typescript
npx hardhat test --grep "ONFTTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "ONFTTests @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

- Finally we're checking whether the NFTs are transferred successfully
```typescript
npx hardhat test --grep "ONFTTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "ONFTTests @bsc @send" --network bsc_testnet
```

### ONFT Adapter

If your NFT contract already exists on the chain you want to connect, you can deploy the ONFT Adapter contract to act as an intermediary lockbox.

- Deploying ERC721s on each chain we want to connect
```typescript
npx hardhat deploy-erc721 --network hedera_testnet
npx hardhat deploy-erc721 --network bsc_testnet
```

- Deploying an ONFT Adapter which will be used as a lockbox of ERC721s deployed the step above
```typescript
npx hardhat deploy-onft-adapter --token <erc721_hedera_address> --network hedera_testnet
npx hardhat deploy-onft-adapter --token <erc721_bsc_address> --network bsc_testnet
```

- In order to connect ONFT Adapters together, we need to set the peer of the target ONFT Adapter, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_onft_adapter_address> --target <bsc_onft_adapter_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_onft_adapter_address> --target <hedera_onft_adapter_address> --network bsc_testnet
```

- Fill the .env

- First, we have to mint some NFTs on each chain
```typescript
npx hardhat test --grep "ONFTAdapterTests @hedera @mint" --network hedera_testnet
npx hardhat test --grep "ONFTAdapterTests @bsc @mint" --network bsc_testnet
```

- Then, we have to approve the Adapter to be able to spend the NFT we want to send to another chain
```typescript
npx hardhat test --grep "ONFTAdapterTests @hedera @approve" --network hedera_testnet
npx hardhat test --grep "ONFTAdapterTests @bsc @approve" --network bsc_testnet
```

- On these steps, we're sending already existing NFTs between chains
```typescript
npx hardhat test --grep "ONFTAdapterTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "ONFTAdapterTests @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

- Finally we're checking whether the NFTs are transferred successfully
```typescript
npx hardhat test --grep "ONFTAdapterTests @hedera @test" --network hedera_testnet
npx hardhat test --grep "ONFTAdapterTests @bsc @test" --network bsc_testnet
```

### HTS Connector

That's a variant of OFT but using an HTS token. Due to several incompatibilities between ERC20 and HTS tokens, we're not able to use them out of the box. All of them are described in the "HTS Adapter vs HTS Connector" section below.

- Deploying OFT on an EVM chain and HTS Connector on the Hedera chain. The HTS Connector extends OFTCore and creates HTS token within its constructor. Also, overrides OFTCore _debit and _credit with related HTS mint and burn precompile calls
```typescript
npx hardhat deploy-hts-connector --network hedera_testnet
npx hardhat deploy-oft --decimals 8 --mint 1000 --network bsc_testnet
```

- In order to connect OFTs together, we need to set the peer of the target OFT, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_oft_address> --target <bsc_oft_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_oft_address> --target <hedera_oft_address> --network bsc_testnet
```

- Fill the .env

- Approving HTS Connector to use some signer's tokens
```typescript
npx hardhat test --grep "HTSConnectorTests @hedera @approve" --network hedera_testnet
```

- On these steps, we're sending tokens from an EVM chain to Hedera and receiving HTS tokens and vice versa
```typescript
npx hardhat test --grep "HTSConnectorTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "HTSConnectorTests @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

Finally we're checking whether the balances are expected on both source and destination chains
```typescript
npx hardhat test --grep "HTSConnectorTests @hedera @test" --network hedera_testnet
npx hardhat test --grep "HTSConnectorTests @bsc @test" --network bsc_testnet
```

### HTS Connector for existing HTS token

That's a variant of OFT but using an already existing HTS token. Keep in mind that "supply key" of the token must contains the HTS Connector contract's address.

- Create an HTS token
```typescript
npx hardhat create-hts-token --network hedera_testnet
```

- Deploying OFT on an EVM chain and HTS Connector on the Hedera chain. The HTS Connector for existing token extends OFTCore and receives the HTS tokens address as constructor parameter. Also, overrides OFTCore _debit and _credit with related HTS mint and burn precompile calls
```
npx hardhat deploy-hts-connector-existing-token --token <existing_hts_token_address> --network hedera_testnet
npx hardhat deploy-oft --decimals 8 --mint 1000 --network bsc_testnet
```

- In order to connect OFTs together, we need to set the peer of the target OFT, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_oft_address> --target <bsc_oft_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_oft_address> --target <hedera_oft_address> --network bsc_testnet
```

- Fill the .env

- Adding the HTSConnectorExistingToken contract's address as a supply key of the existing HTS token
```typescript
npx hardhat test --grep "HTSConnectorExistingToken @hedera @update-keys" --network hedera_testnet
```

- Funding the HTSConnectorExistingToken contract
```typescript
npx hardhat test --grep "HTSConnectorExistingToken @hedera @fund" --network hedera_testnet
```

- Approving HTS Connector to use some signer's tokens
```typescript
npx hardhat test --grep "HTSConnectorExistingToken @hedera @approve" --network hedera_testnet
```

- On these steps, we're sending tokens from an EVM chain to Hedera and receiving HTS tokens and vice versa
```typescript
npx hardhat test --grep "HTSConnectorExistingToken @hedera @send" --network hedera_testnet
npx hardhat test --grep "HTSConnectorExistingToken @bsc @send" --network bsc_testnet
```

- Wait a couple of minutes, the LZ progress can be tracked on https://testnet.layerzeroscan.com/tx/<tx_hash>

- Finally we're checking whether the balances are expected on both source and destination chains
```typescript
npx hardhat test --grep "HTSConnectorExistingToken @hedera @test" --network hedera_testnet
npx hardhat test --grep "HTSConnectorExistingToken @bsc @test" --network bsc_testnet
```

### WHBAR flow

Wrap and transfer HBARs across different chains.

- Deploying WHBAR and ERC20
```typescript
npx hardhat deploy-whbar --network hedera_testnet
npx hardhat deploy-erc20 --decimals 8 --mint 100000000 --network bsc_testnet
```

- Deploying an OFT Adapters which will be used as a lockbox of WHBAR and ERC20 deployed the step above
```typescript
npx hardhat deploy-oft-adapter --token <whbar_hedera_address> --network hedera_testnet
npx hardhat deploy-oft-adapter --token <erc20_bsc_address> --network bsc_testnet
```

- In order to connect OFT Adapters together, we need to set the peer of the target OFT Adapter, more info can be found here https://docs.layerzero.network/v2/developers/evm/getting-started#connecting-your-contracts
```typescript
npx hardhat set-peer --source <hedera_oft_adapter_address> --target <bsc_oft_adapter_address> --network hedera_testnet
npx hardhat set-peer --source <bsc_oft_adapter_address> --target <hedera_oft_adapter_address> --network bsc_testnet
```

- Fill the .env

- Depositing some HBARs and wrapping them into WHBAR
```typescript
npx hardhat test --grep "WHBARTests @hedera @deposit" --network hedera_testnet
```

- Here we're funding the Adapter on both chains with some liquidity and after that we're approving it to spend the signer's token
```typescript
npx hardhat test --grep "WHBARTests @hedera @fund-and-approve" --network hedera_testnet
npx hardhat test --grep "WHBARTests @bsc @fund-and-approve" --network bsc_testnet
```

- On these steps, we're sending already existing WHBARs that are used by OFT Adapter between different chains
```typescript
npx hardhat test --grep "WHBARTests @hedera @send" --network hedera_testnet
npx hardhat test --grep "WHBARTests @bsc @send" --network bsc_testnet
```

- Finally we're checking whether the tokens are transferred successfully
```typescript
npx hardhat test --grep "WHBARTests @hedera @test" --network hedera_testnet
npx hardhat test --grep "WHBARTests @bsc @test" --network bsc_testnet
```

### Useful information:
- The addresses of endpoints [here](https://github.com/hiero-ledger/hiero-json-rpc-relay/blob/1030-lz-setup/tools/layer-zero-example/hardhat.config.js#L60) are the official LZ endpoints. A entire list of LZ supported endpoints can be found on https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts.

### HTS Adapter vs HTS Connector
- You could use a HTS Adapter when you already have an existing HTS token on the fly.
- You could use a HTS Connector when you want to create a new token.
- You could use a HTS Connector with the existing HTS token but you have to add the HTS Connector contract as the Supply Key of the HTS token in order to execute the needed burnToken/mintToken precompile calls.
- The main reason of using a HTS Connector instead of HTS Adapter is to avoid liquidity logic.
