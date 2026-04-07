import React, { useState, useCallback, useEffect } from 'react';
import { Button, Typography, TextField, Link } from '@mui/material';
import Greeter from '../contracts/Greeter.json';
import { ethers } from 'ethers';

const ContractInteractions = ({ signer, isConnected, chain, address }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [contractAddress, setContractAddress] = useState(null);
  const [deployContractMsg, setDeployContractMsg] = useState(null);
  const [contractCallViewMsg, setContractCallViewMsg] = useState(null);
  const [contractCallUpdateMsg, setContractCallUpdateMsg] = useState(null);
  const [contractCallUpdateMsgInput, setContractCallUpdateMsgInput] = useState('');

  // clear state vars on a chain or address have changed
  useEffect(() => {
    setIsLoading(false);
    setContractAddress(null);
    setDeployContractMsg(null);
    setContractCallViewMsg(null);
    setContractCallUpdateMsg(null);
    setContractCallUpdateMsgInput('');
  }, [chain, address]);

  const deployContractHandler = useCallback(async () => {
    try {
      setIsLoading(true);
      setDeployContractMsg('Loading...');

      const contractFactory = new ethers.ContractFactory(Greeter.abi, Greeter.bytecode, signer);
      const contract = await contractFactory.deploy('initial_msg', { gasLimit: 1_000_000 });
      await contract.waitForDeployment();
      setContractAddress(contract.target);

      setIsLoading(false);
      setDeployContractMsg('Addr: ' + contract.target);
    } catch (error) {
      console.error(error.message);
      setDeployContractMsg(null);
      setIsLoading(false);
    }
  }, [signer]);

  const contractCallViewHandler = useCallback(async () => {
    try {
      setIsLoading(true);
      setContractCallViewMsg('Loading...');

      const contract = new ethers.Contract(contractAddress, Greeter.abi, signer);
      const call = await contract.greet();

      setContractCallViewMsg('Result: ' + call);
      setIsLoading(false);
    } catch (error) {
      console.error(error.message);
      setContractCallViewMsg(null);
      setIsLoading(false);
    }
  }, [signer, contractAddress]);

  const contractCallUpdateHandler = useCallback(async () => {
    try {
      if (!contractCallUpdateMsgInput) return;

      setIsLoading(true);
      setContractCallUpdateMsg('Loading...');

      const contract = new ethers.Contract(contractAddress, Greeter.abi, signer);
      const tx = await contract.setGreeting(contractCallUpdateMsgInput, { gasLimit: 1_000_000 });
      await tx.wait();

      setContractCallUpdateMsg('Updated text: ' + contractCallUpdateMsgInput);
      setIsLoading(false);
    } catch (error) {
      console.error(error.message);
      setContractCallUpdateMsg(null);
      setContractCallUpdateMsgInput('');
      setIsLoading(false);
    }
  }, [signer, contractAddress, contractCallUpdateMsgInput]);

  return (
    <>
      <Typography variant="h5" sx={{ textDecoration: 'underline' }}>
        {' '}
        Contract Interactions{' '}
      </Typography>
      <br />
      <Typography variant="h6">
        {' '}
        Source:{' '}
        <Link
          href="https://github.com/NomicFoundation/hardhat/blob/master/packages/hardhat-core/sample-projects/basic/contracts/Greeter.sol"
          rel="noreferrer"
          target="_blank"
        >
          Greeter.sol
        </Link>{' '}
      </Typography>

      <Button
        id="btnDeployContract"
        onClick={deployContractHandler}
        disabled={!isConnected || isLoading}
        size="medium"
        variant="contained"
        color="primary"
      >
        Deploy contract
      </Button>
      <br />
      <Typography variant="h6"> {deployContractMsg} </Typography>
      <br />
      <br />
      <Button
        id="btnReadGreeting"
        onClick={contractCallViewHandler}
        disabled={!isConnected || isLoading}
        size="medium"
        variant="contained"
        color="primary"
      >
        Read greeting
      </Button>
      <br />
      <Typography id="contractViewMsg" variant="h6">
        {' '}
        {contractCallViewMsg}{' '}
      </Typography>
      <br />
      <TextField
        id="updateGreetingText"
        fullWidth
        label="Greeting message"
        sx={{ m: 1 }}
        variant="standard"
        value={contractCallUpdateMsgInput}
        onChange={(e) => setContractCallUpdateMsgInput(e.target.value)}
      />
      <br />
      <Button
        id="btnUpdateGreeting"
        onClick={contractCallUpdateHandler}
        disabled={!isConnected || isLoading}
        size="medium"
        variant="contained"
        color="primary"
      >
        Update greeting
      </Button>
      <br />
      <Typography id="contractUpdateMsg" variant="h6">
        {' '}
        {contractCallUpdateMsg}{' '}
      </Typography>
    </>
  );
};

export default ContractInteractions;
