// SPDX-License-Identifier: Apache-2.0

require('dotenv').config();
const fs = require('fs');
const { Web3 } = require('web3');

module.exports = async (contractParam) => {
  const { abi, bytecode } = await JSON.parse(fs.readFileSync(__dirname + '/../contract/Greeter.json'));

  const web3 = new Web3(new Web3.providers.HttpProvider(process.env.RELAY_ENDPOINT));
  const wallet = await web3.eth.accounts.wallet.add(process.env.OPERATOR_PRIVATE_KEY);
  const Greeter = new web3.eth.Contract(abi);
  const greeter = await Greeter.deploy({
    data: bytecode,
    arguments: [contractParam],
  });
  const contract = await greeter.send({
    from: wallet[0].address,
  });

  console.log(`Greeter deployed to: ${contract._address}`);

  return contract._address;
};
