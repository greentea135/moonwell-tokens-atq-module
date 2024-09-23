import fetch from "node-fetch";
import { ContractTag, ITagService } from "atq-types";

// Define the subgraph URLs
const SUBGRAPH_URLS: Record<string, { decentralized: string }> = {
  // Moonbeam subgraph, by subgraphs.messari.eth (0x7e8f317a45d67e27e095436d2d0d47171e7c769f)
  "1284": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/DQhrdUHwspQf3hSjDtyfS6uqq9YiKoLF3Ut3U9os2HK",
  },
  // Moonriver subgraph, by subgraphs.messari.eth (0x7e8f317a45d67e27e095436d2d0d47171e7c769f)
  "1285": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/8ayELti1UNCNCWuvwSwapjh4mvvCejeXsk4PmsWBmQ82",
  },
  // Base subgraph, by subgraphs.messari.eth (0x7e8f317a45d67e27e095436d2d0d47171e7c769f)
  "8453": {
    decentralized:
      "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/33ex1ExmYQtwGVwri1AP3oMFPGSce6YbocBP7fWbsBrg",
  },
};

// Define the Token interface
interface Token {
  id: string;
  name: string;
  symbol: string;
}

// Define the Market interface reflecting the GraphQL response
interface Market {
  outputToken: Token;
  createdTimestamp: number;
}

// Define the GraphQL response structure
interface GraphQLData {
  markets: Market[];
}

interface GraphQLResponse {
  data?: GraphQLData;
  errors?: { message: string }[]; // Assuming the API might return errors in this format
}

// Define headers for the query
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Define the GraphQL query
const GET_MARKETS_QUERY = `
query GetMarkets($lastTimestamp: Int) {
  markets(
    first: 1000,
    orderBy: createdTimestamp,
    orderDirection: asc,
    where: { createdTimestamp_gt: $lastTimestamp }
  ) {
    outputToken {
      id
      name
      symbol
    }
    createdTimestamp
  }
}
`;

// Type guard for errors
function isError(e: unknown): e is Error {
  return (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof (e as Error).message === "string"
  );
}

// Function to check for invalid values
function containsInvalidValue(text: string): boolean {
  const containsHtml = /<[^>]*>/.test(text);
  const isEmpty = text.trim() === "";
  return isEmpty || containsHtml;
}

// Function to truncate strings
function truncateString(text: string, maxLength: number) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 3) + "..."; // Subtract 3 for the ellipsis
  }
  return text;
}

// Function to fetch data from the GraphQL endpoint
async function fetchData(
  subgraphUrl: string,
  lastTimestamp: number
): Promise<Market[]> {
  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: GET_MARKETS_QUERY,
      variables: { lastTimestamp },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;
  if (result.errors) {
    result.errors.forEach((error) => {
      console.error(`GraphQL error: ${error.message}`);
    });
    throw new Error("GraphQL errors occurred: see logs for details.");
  }

  if (!result.data || !result.data.markets) {
    throw new Error("No markets data found.");
  }

  return result.data.markets;
}

// Function to prepare the URL with the provided API key
function prepareUrl(chainId: string, apiKey: string): string {
  const urls = SUBGRAPH_URLS[chainId];
  if (!urls || isNaN(Number(chainId))) {
    const supportedChainIds = Object.keys(SUBGRAPH_URLS).join(", ");
    throw new Error(
      `Unsupported or invalid Chain ID provided: ${chainId}. Only the following values are accepted: ${supportedChainIds}`
    );
  }
  return urls.decentralized.replace("[api-key]", encodeURIComponent(apiKey));
}

// Function to transform market data into ContractTag objects
function transformMarketsToTags(chainId: string, markets: Market[]): ContractTag[] {
  const validMarkets: Market[] = [];
  const rejectedSymbols: string[] = [];

  markets.forEach((market) => {
    const symbolInvalid = containsInvalidValue(market.outputToken.symbol);

    if (symbolInvalid) {
      rejectedSymbols.push(`Market: ${market.outputToken.id} rejected due to invalid symbol - Symbol: ${market.outputToken.symbol}`);
    } else {
      validMarkets.push(market);
    }
  });

  if (rejectedSymbols.length > 0) {
    console.log("Rejected markets:", rejectedSymbols);
  }

  return validMarkets.map((market) => {
    const maxNameLength = 44;
    const truncatedNameText = truncateString(market.outputToken.symbol, maxNameLength);

    return {
      "Contract Address": `eip155:${chainId}:${market.outputToken.id}`,
      "Public Name Tag": `${truncatedNameText} Token`,
      "Project Name": "Moonwell",
      "UI/Website Link": "https://moonwell.fi/",
      "Public Note": `Moonwell's ${market.outputToken.symbol} (${market.outputToken.name}) token contract.`,
    };
  });
}

// The main logic for this module
class TagService implements ITagService {
  returnTags = async (
    chainId: string,
    apiKey: string
  ): Promise<ContractTag[]> => {
    let allTags: ContractTag[] = [];
    let lastTimestamp: number = 0;
    let isMore = true;

    const url = prepareUrl(chainId, apiKey);

    while (isMore) {
      try {
        const markets = await fetchData(url, lastTimestamp);
        const tags = transformMarketsToTags(chainId, markets);
        allTags.push(...tags);

        isMore = markets.length === 1000; // Continue if we fetched 1000 records
        if (isMore) {
          lastTimestamp = Math.max(...markets.map(m => m.createdTimestamp));
        }
      } catch (error) {
        if (isError(error)) {
          console.error(`An error occurred: ${error.message}`);
          throw new Error(`Failed fetching data: ${error}`); // Propagate a new error with more context
        } else {
          console.error("An unknown error occurred.");
          throw new Error("An unknown error occurred during fetch operation."); // Throw with a generic error message if the error type is unknown
        }
      }
    }
    return allTags;
  };
}

// Creating an instance of TagService
const tagService = new TagService();

// Exporting the returnTags method directly
export const returnTags = tagService.returnTags;

