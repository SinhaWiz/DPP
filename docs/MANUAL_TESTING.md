# Manual test checklist: MetaMask

The automated tests use the built-in demo accounts. Anything that needs a real wallet extension is checked by hand with this list. Run it before a release, and after changing `frontend/src/web3/`.

## Set-up

1. `npm run dev` (node, deploy, seed, backend, web). Open http://127.0.0.1:5173.
2. A fresh browser profile with the MetaMask extension is easiest. Unlock it.

Mark each step ✔ or ✘ and write down what you saw when it is ✘.

## 1. Network

| # | Do | Expect |
|---|---|---|
| 1.1 | In **Act as**, choose *MetaMask (my wallet)* while MetaMask is on Ethereum Mainnet | MetaMask asks to add or switch to "Hardhat Local" (chain id 31337, RPC http://127.0.0.1:8545). Approving makes the page continue. |
| 1.2 | Refuse the network prompt | A clear message that the wrong network is selected, with a button to try again. The page keeps working in demo mode. |
| 1.3 | Switch MetaMask to another network while the page is open | A wrong-network banner appears within a second; sending is disabled. Switching back removes it. |

## 2. Accounts

| # | Do | Expect |
|---|---|---|
| 2.1 | Import dev account #0 (private key from the Hardhat node's start-up output) | Its address shows next to **Act as**, with the role name *Manufacturer*. |
| 2.2 | Switch to another account in MetaMask | The page follows (`accountsChanged`) without a reload; the role name updates. |
| 2.3 | Use an account that is not a dev account | Role shows as *Outsider*/your own account; actions that need a role predict a failure before sending. |

## 3. Signing each action

For each action in the **Actions** panel, with the right account, press **Send** and confirm in MetaMask. The pipeline must reach *Verified*, and the new record must appear on the chain.

- [ ] Register a product
- [ ] List for sale
- [ ] Delist
- [ ] Buy now (the amount in MetaMask equals the price)
- [ ] Reserve
- [ ] Confirm reservation / Reject reservation
- [ ] Cancel reservation (buyer) and Revoke after expiry
- [ ] Withdraw funds (pull payment)

## 4. Rejection and failure

| # | Do | Expect |
|---|---|---|
| 4.1 | Press **Send**, then *Reject* in MetaMask | The pipeline stops at "Not signed" with the explanation "You rejected the request"; nothing is recorded; the form is usable again. |
| 4.2 | Pick an action that would fail (e.g. delist someone else's product) and press **Send** | The prediction says it would fail, and **Send anyway** shows the revert reason after MetaMask confirms. Nothing is recorded. |
| 4.3 | Send with a gas limit that is too low (edit it in MetaMask) | The failure is explained (out of gas); the pipeline marks "Mined (reverted)". |

## 5. Pending, replace, drop

Switch to **Step** mode so transactions stay pending.

| # | Do | Expect |
|---|---|---|
| 5.1 | Send an action and confirm | It sits in the mempool tray as *Pending*. |
| 5.2 | In MetaMask, use *Speed up* | The original shows *Replaced* (struck through) and the new transaction takes its place. |
| 5.3 | Send another, then use *Cancel* in MetaMask | The original shows *Replaced*; nothing is recorded. |
| 5.4 | Press **Mine block** | The remaining pending transaction is mined and recorded. |
| 5.5 | Switch back to **Auto** | Later transactions confirm immediately. |

## 6. Restarting the node

| # | Do | Expect |
|---|---|---|
| 6.1 | Stop and restart `npm run dev:node` (the chain starts empty) | The page shows that the node was restarted and that the contract is missing or the chain is new; it does not show stale data as current. |
| 6.2 | Re-run `npm run dev:deploy` and `npm run dev:seed` | The page recovers on its own and shows the new chain. |
| 6.3 | Send a transaction from MetaMask | It fails with a nonce error, and the page explains it (MetaMask remembers the old nonce). Fix: MetaMask → Settings → Advanced → *Clear activity tab data*. After that it works. |

## 7. Backend down

| # | Do | Expect |
|---|---|---|
| 7.1 | Stop the backend only | "Backend offline: read-only view"; the chain and the in-browser verification still work. |
| 7.2 | Start it again | The page reconnects by itself and history, mempool and lab return. |
