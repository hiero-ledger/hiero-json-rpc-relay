// SPDX-License-Identifier: Apache-2.0

import * as dotenv from "dotenv";
import expected from "./expected.json";
import hre from "hardhat";
import { IGravatarResponse } from "./types/gravatar/IGravatarResponse";
import { ITokenResponse } from "./types/token/ITokenResponse";
import {
  getData,
  verifyGravatarEvents,
  verifyTokenEvents,
} from "./helpers/subgraph-helpers";

dotenv.config();

const GRAVATAR_QUERY =
  "query { gravatars(orderBy: id) { id owner displayName imageUrl } }";
const ERC20_QUERY =
  "query { erc20S(orderBy: id) { id supply type transfers { from to amount } } }";
const HTSFT_QUERY =
  "query { htsfts(orderBy: id) { id supply type transfers { from to amount } } }";
const NFTHTS_QUERY =
  "query { htsnfts(orderBy: id) { id owner type tokenId transfers { from to } } }";
const ERC721_QUERY =
  "query { erc721S(orderBy: id) { id owner type tokenId transfers { from to } } }";

const TOKEN_QUERIES = [
  {
    name: "ERC20_QUERY",
    actualData: "erc20S",
    expectedData: expected.erc20,
    query: ERC20_QUERY,
  },
  {
    name: "ERC721_QUERY",
    actualData: "erc721S",
    expectedData: expected.erc721,
    query: ERC721_QUERY,
  },
  {
    name: "HTSFT_QUERY",
    actualData: "htsfts",
    expectedData: expected.htsfts,
    query: HTSFT_QUERY,
  },
  {
    name: "HTSNFT_QUERY",
    actualData: "htsnfts",
    expectedData: expected.htsnfts,
    query: NFTHTS_QUERY,
  },
];

describe("Subgraph", () => {
  describe("Can index past events", () => {
    it("Indexes past GravatarRegistry events correctly", async () => {
      const result = await getData<IGravatarResponse>(GRAVATAR_QUERY);
      const gravatars = result.data.gravatars;
      verifyGravatarEvents(gravatars, expected.gravatar.initial);
    });

    for (const query of TOKEN_QUERIES) {
      it(`Indexes past ${query.name} events correctly`, async () => {
        const result = await getData<ITokenResponse>(query.query);
        const tokenEvents = result.data[query.actualData];
        verifyTokenEvents(tokenEvents, query.expectedData.initial);
      });
    }
  });

  describe("Can index new events", () => {
    before("Interact with contracts", async () => {
      await hre.run("interactWithContracts");
      await new Promise((r) => setTimeout(r, 2000)); //set two second wait, so that the graph have time to index events
    });

    it("Indexes new GravatarRegistry events correctly", async () => {
      const result = await getData<IGravatarResponse>(GRAVATAR_QUERY);
      const gravatars = result.data.gravatars;
      verifyGravatarEvents(gravatars, expected.gravatar.updated);
    });

    for (const query of TOKEN_QUERIES) {
      it(`Indexes new ${query.name} events correctly`, async () => {
        const result = await getData<ITokenResponse>(query.query);
        const tokenEvents = result.data[query.actualData];
        verifyTokenEvents(tokenEvents, query.expectedData.updated);
      });
    }
  });
});
