import React, { useState, useCallback, useEffect } from 'react';
import { Button, TextField, Typography } from '@mui/material';
import { ethers } from 'ethers';
import IHRC from '../contracts/IHRC.json';

const AssociateHTSTokensForm = ({ signer, isConnected, chain, address }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [htsTokenAddress, setHtsTokenAddress] = useState('');
  const [htsTokenAssociateMsg, setHtsTokenAssocaiteMsg] = useState(null);

  // clear state vars on a chain or address have changed
  useEffect(() => {
    setIsLoading(false);
    setHtsTokenAddress('');
    setHtsTokenAssocaiteMsg(null);
  }, [chain, address]);

  const htsTokenAssociate = useCallback(async () => {
    const hrcToken = new ethers.Contract(htsTokenAddress, new ethers.Interface(IHRC), signer);

    try {
      setIsLoading(true);
      setHtsTokenAssocaiteMsg('Loading...');

      const txAssociate = await hrcToken.associate({ gasLimit: 1_000_0000 });
      const receiptAssociate = await txAssociate.wait();

      setHtsTokenAssocaiteMsg(receiptAssociate.status === 1 ? 'Done' : 'There was an error.');
      setIsLoading(false);
    } catch (e) {
      console.error(e);
      setHtsTokenAssocaiteMsg('There was an error.');
      setIsLoading(false);
    }
  }, [signer, htsTokenAddress]);

  return (
    <>
      <Typography variant="h5" sx={{ textDecoration: 'underline' }}>
        {' '}
        Associate HTS Tokens{' '}
      </Typography>
      <br />
      <TextField
        id="htsTokenAssociateAddressField"
        fullWidth
        label="Token address"
        sx={{ m: 1 }}
        variant="standard"
        value={htsTokenAddress}
        onChange={(e) => setHtsTokenAddress(e.target.value)}
      />
      <br />
      <Button
        id="htsTokenAssociateBtn"
        onClick={htsTokenAssociate}
        disabled={!isConnected || isLoading}
        size="medium"
        variant="contained"
        color="primary"
      >
        Associate
      </Button>
      <br />
      <Typography id="htsTokenAssociateMsg" variant="h6">
        {' '}
        {htsTokenAssociateMsg}{' '}
      </Typography>
    </>
  );
};

export default AssociateHTSTokensForm;
