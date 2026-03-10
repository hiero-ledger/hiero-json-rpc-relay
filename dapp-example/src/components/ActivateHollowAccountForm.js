import React, { useState, useCallback, useEffect } from 'react';
import { Button, TextField, Typography } from '@mui/material';
import { ethers } from 'ethers';
import ContractTransferTx from '../contracts/ContractTransferTx.json';
import bootstrapInfo from '../contracts/.bootstrapInfo.json';

const ActivateHollowAccountForm = ({ signer, isConnected, chain, address }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [hollowAccountAddress, setHollowAccountAddress] = useState('');
  const [activateHollowAccountMsg, setActivateHollowAccountMsg] = useState(null);

  // clear state vars on a chain or address have changed
  useEffect(() => {
    setIsLoading(false);
    setHollowAccountAddress('');
    setActivateHollowAccountMsg(null);
  }, [chain, address]);

  const activateHollowAccount = useCallback(async () => {
    const contract = new ethers.Contract(bootstrapInfo.CONTRACT_TRANSFER_TX_ADDRESS, ContractTransferTx.abi, signer);

    try {
      setIsLoading(true);
      setActivateHollowAccountMsg('Loading...');

      const tx = await contract.transferTo(hollowAccountAddress, 3_000_000_000, { gasLimit: 1_000_000 });
      const receipt = await tx.wait();

      setActivateHollowAccountMsg(receipt.logs[0].fragment.name == 'Transferred' ? 'Done' : 'There was an error.');
      setIsLoading(false);
    } catch (e) {
      console.error(e);
      setActivateHollowAccountMsg('There was an error.');
      setIsLoading(false);
    }
  }, [signer, hollowAccountAddress]);

  return (
    <>
      <Typography variant="h5" sx={{ textDecoration: 'underline' }}>
        {' '}
        Activate Hollow Account{' '}
      </Typography>
      <br />
      <TextField
        id="hollowAccountAddressField"
        fullWidth
        label="Hollow account address"
        sx={{ m: 1 }}
        variant="standard"
        value={hollowAccountAddress}
        onChange={(e) => setHollowAccountAddress(e.target.value)}
      />
      <br />
      <Button
        id="activateHollowAccountBtn"
        onClick={activateHollowAccount}
        disabled={!isConnected || isLoading}
        size="medium"
        variant="contained"
        color="primary"
      >
        Activate
      </Button>
      <br />
      <Typography id="activateHollowAccountMsg" variant="h6">
        {' '}
        {activateHollowAccountMsg}{' '}
      </Typography>
    </>
  );
};

export default ActivateHollowAccountForm;
