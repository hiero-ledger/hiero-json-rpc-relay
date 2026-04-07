import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Grid, TextField, Typography } from '@mui/material';
import { Box, Container } from '@mui/system';
import { ethers } from 'ethers';

import useHederaSdk from './hooks/useHederaSdk';

import ContractInteractions from './components/ContractInteractions';
import TransferHTSTokensForm from './components/TransferHTSTokensForm';
import AssociateHTSTokensForm from './components/AssociateHTSTokensForm';
import ActivateHollowAccountForm from './components/ActivateHollowAccountForm';

function App() {
  const [errorMessage, setErrorMessage] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState(null);
  const [alias, setAlias] = useState('');
  const [balance, setBalance] = useState(null);
  const [hbarsAmount, setHbarsAmount] = useState(0);
  const [hbarsToAddress, setHbarsToAddress] = useState('');
  const [sendHbarMsg, setSendHbarMsg] = useState(null);
  const [toBalanceAfterTransfer, setToBalanceAfterTransfer] = useState('');

  const { recoveredPublicKeyToAccountId } = useHederaSdk();

  useEffect(() => {
    if (window.ethereum) {
      const provider = new ethers.BrowserProvider(window.ethereum, 'any');

      provider.getSigner().then((signer) => setSigner(signer));

      window.ethereum.on('accountsChanged', changeConnectedAccount);
      window.ethereum.on('chainChanged', (chainId) => {
        setErrorMessage(null);
        setAddress(null);
        setBalance(null);
        setAlias('');
        setChain(chainId);
        setHbarsAmount(0);
        setHbarsToAddress('');
        setHbarsToAddress(null);
        setToBalanceAfterTransfer('');
      });
    }
  }, []);

  const isConnected = useMemo(() => {
    return !!signer && !!address;
  }, [signer, address]);

  const isAccountActivated = useMemo(() => {
    return address && Number(balance) > 0;
  }, [address, balance]);

  const status = useMemo(() => {
    return {
      label: isAccountActivated ? 'Account is active' : 'Account not created yet',
      color: isAccountActivated ? 'success' : 'error',
    };
  }, [isAccountActivated]);

  const fetchAccountBalance = async (accountAddress) => {
    try {
      let formattedBalance = null;
      if (accountAddress) {
        const accountBalance = await window.ethereum.request({
          method: 'eth_getBalance',
          params: [accountAddress.toString(), 'latest'],
        });
        formattedBalance = ethers.formatEther(accountBalance);
      }
      setBalance(formattedBalance);
    } catch (error) {
      console.log(error);
    }
  };

  const changeConnectedAccount = async (newAddress) => {
    try {
      newAddress = Array.isArray(newAddress) ? newAddress[0] : newAddress;

      await fetchAccountBalance(newAddress);

      setAddress(newAddress);
      setErrorMessage(null);
      setAlias('');
    } catch (err) {
      console.error(err);
      setErrorMessage('There was a problem connecting to MetaMask');
    }
  };

  const connectAccountHandler = useCallback(async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        });

        await changeConnectedAccount(accounts[0]);
      } catch (err) {
        console.error(err);
        setErrorMessage('There was a problem connecting to MetaMask');
      }
    } else {
      setErrorMessage('Install MetaMask');
    }
  }, []);

  const showAccountIdHandler = useCallback(async () => {
    try {
      const message = address + '_' + Date.now();
      const msgHash = ethers.hashMessage(message);
      const msgHashBytes = ethers.getBytes(msgHash);

      const signature = await signer.signMessage(message);

      const recoveredPubKey = ethers.SigningKey.recoverPublicKey(msgHashBytes, signature);
      const accountId = recoveredPublicKeyToAccountId(recoveredPubKey);

      setAlias(accountId.aliasKey.toStringRaw());
    } catch (error) {
      console.error(error.message);
    }
  }, [signer, address]);

  const sendHbarsBtnHandle = useCallback(async () => {
    const tx = await signer.sendTransaction({
      to: hbarsToAddress,
      value: hbarsAmount,
      gasLimit: 1_000_000,
    });
    await tx.wait();

    setToBalanceAfterTransfer(
      ethers.formatEther(
        await window.ethereum.request({
          method: 'eth_getBalance',
          params: [hbarsToAddress, 'latest'],
        }),
      ),
    );
    setSendHbarMsg('Done');
  }, [signer, hbarsToAddress, hbarsAmount]);

  return (
    <Container>
      {errorMessage ? (
        <Typography variant="body1" color="red">
          Error: {errorMessage}
        </Typography>
      ) : null}
      <Box display="flex" justifyContent="center" alignItems="center" paddingTop={10} paddingBottom={10}>
        <Button onClick={connectAccountHandler} disabled={isConnected} size="large" variant="contained" color="primary">
          {isConnected ? 'Connected' : 'Connect Account'}
        </Button>
      </Box>

      <Grid container spacing={2} justifyContent="center">
        <Grid item md={8}>
          {/* Account Section */}
          <Typography variant="h5" sx={{ textDecoration: 'underline' }}>
            {' '}
            Setup Account{' '}
          </Typography>
          <Typography variant="h6"> Address: {address} </Typography>
          <Typography variant="h6">Balance: {balance ? balance + ' HBAR' : null}</Typography>
          <Typography variant="h6" style={{ wordBreak: 'break-word' }}>
            Status: {isConnected ? <Chip label={status.label} color={status.color} /> : null}
          </Typography>
          <br />
          <Button
            id="showAliasBtn"
            onClick={showAccountIdHandler}
            disabled={!isConnected}
            size="medium"
            variant="contained"
            color="primary"
          >
            Show alias
          </Button>
          <Typography id="aliasField" variant="h6" style={{ wordBreak: 'break-word' }}>
            {alias}
          </Typography>
          <br />

          <Typography variant="h5" sx={{ textDecoration: 'underline' }}>
            {' '}
            Send HBARs{' '}
          </Typography>
          <TextField
            id="sendHbarsToField"
            fullWidth
            label="To"
            sx={{ m: 1 }}
            variant="standard"
            value={hbarsToAddress}
            onChange={(e) => setHbarsToAddress(e.target.value)}
          />
          <TextField
            id="sendHbarsAmountField"
            fullWidth
            label="Amount"
            sx={{ m: 1 }}
            variant="standard"
            type="number"
            value={hbarsAmount}
            onChange={(e) => setHbarsAmount(e.target.value)}
          />
          <Typography variant="h6" id="toBalanceAfterTransfer">
            {' '}
            Balance after transfer: {toBalanceAfterTransfer}{' '}
          </Typography>
          <Button
            id="sendHbarsBtn"
            onClick={sendHbarsBtnHandle}
            disabled={!isConnected}
            size="medium"
            variant="contained"
            color="primary"
          >
            Send
          </Button>
          <br />
          <Typography id="sendHbarMsg" variant="h6">
            {' '}
            {sendHbarMsg}{' '}
          </Typography>

          {/* Contracts Section */}
          <Box sx={{ mt: '2em', mb: '2em' }}>
            <ContractInteractions isConnected={isConnected} signer={signer} chain={chain} address={address} />
          </Box>
          <Box sx={{ mt: '2em', mb: '2em' }}>
            <TransferHTSTokensForm isConnected={isConnected} signer={signer} chain={chain} address={address} />
          </Box>
          <Box sx={{ mt: '2em', mb: '2em' }}>
            <AssociateHTSTokensForm isConnected={isConnected} signer={signer} chain={chain} address={address} />
          </Box>
          <Box sx={{ mt: '2em', mb: '2em' }}>
            <ActivateHollowAccountForm isConnected={isConnected} signer={signer} chain={chain} address={address} />
          </Box>
        </Grid>
      </Grid>
    </Container>
  );
}

export default App;
