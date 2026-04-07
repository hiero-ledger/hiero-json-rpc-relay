import React, { useState, useCallback, useEffect } from 'react';
import { Button, TextField, Typography } from '@mui/material';
import { ethers } from 'ethers';
import ERC20ABI from '../contracts/ERC20ABI.json';

const TransferHTSTokensForm = ({ signer, isConnected, chain, address }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [htsTokenAddress, setHtsTokenAddress] = useState('');
  const [htsTokenReceiverAddress, setHtsTokenReceiverAddress] = useState('');
  const [htsTokenAmount, setHtsTokenAmount] = useState(0);
  const [htsTokenMsg, setHtsTokenMsg] = useState(null);

  // clear state vars on a chain or address have changed
  useEffect(() => {
    setIsLoading(false);
    setHtsTokenAddress('');
    setHtsTokenReceiverAddress('');
    setHtsTokenAmount(0);
    setHtsTokenMsg(null);
  }, [chain, address]);

  const htsTokenTransfer = useCallback(async () => {
    try {
      setIsLoading(true);
      setHtsTokenMsg('Loading...');

      const contract = new ethers.Contract(htsTokenAddress, ERC20ABI, signer);
      const tx = await contract.transfer(htsTokenReceiverAddress, htsTokenAmount, { gasLimit: 1_000_000 });
      await tx.wait();

      setHtsTokenMsg('Done');
      setIsLoading(false);
    } catch (error) {
      console.error(error.message);
      setHtsTokenMsg(null);
      setIsLoading(false);
    }
  }, [signer, htsTokenAddress, htsTokenReceiverAddress, htsTokenAmount]);

  return (
    <>
      <Typography variant="h5" sx={{ textDecoration: 'underline' }}>
        {' '}
        HTS Tokens{' '}
      </Typography>
      <br />
      <Typography variant="h6" color="orange">
        {' '}
        Make sure that the receiving address is associated to the specified HTS token{' '}
      </Typography>
      <TextField
        id="htsTokenAddressField"
        fullWidth
        label="Token address"
        sx={{ m: 1 }}
        variant="standard"
        value={htsTokenAddress}
        onChange={(e) => setHtsTokenAddress(e.target.value)}
      />
      <br />
      <TextField
        id="htsReceiverAddressField"
        fullWidth
        label="Receiver address"
        sx={{ m: 1 }}
        variant="standard"
        value={htsTokenReceiverAddress}
        onChange={(e) => setHtsTokenReceiverAddress(e.target.value)}
      />
      <br />
      <TextField
        id="htsTokenAmountField"
        fullWidth
        label="Amount"
        sx={{ m: 1 }}
        variant="standard"
        value={htsTokenAmount}
        type="number"
        onChange={(e) => setHtsTokenAmount(e.target.value)}
      />
      <br />
      <Button
        id="htsTokenTransferBtn"
        onClick={htsTokenTransfer}
        disabled={!isConnected || isLoading}
        size="medium"
        variant="contained"
        color="primary"
      >
        Transfer
      </Button>
      <br />
      <Typography id="htsTokenMsg" variant="h6">
        {' '}
        {htsTokenMsg}{' '}
      </Typography>
    </>
  );
};

export default TransferHTSTokensForm;
