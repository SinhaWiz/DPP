/**
 * The lines of BuySellTraceability.sol that raise each error, shown in Detailed mode. A test checks
 * that every snippet appears in the real contract source, so these cannot drift from the code.
 */
export interface Snippet {
  title: string;
  /** Lines copied from the contract, one per entry. */
  lines: string[];
}

export const SNIPPETS: Record<string, Snippet> = {
  EmptyName: { title: "registerProduct", lines: ["if (bytes(name).length == 0) revert EmptyName();"] },
  InvalidPrice: { title: "listForSale", lines: ["if (price == 0) revert InvalidPrice();"] },
  ProductNotFound: { title: "_product", lines: ["if (productId == 0 || productId > productCount) revert ProductNotFound(productId);"] },
  NotProductOwner: { title: "modifier onlyProductOwner", lines: ["if (_product(productId).owner != msg.sender) revert NotProductOwner(productId, msg.sender);"] },
  NotListed: { title: "_requirePurchasable", lines: ["if (!_isListed(product)) revert NotListed(product.id);"] },
  CannotBuyOwnProduct: { title: "_requirePurchasable", lines: ["if (msg.sender == product.owner) revert CannotBuyOwnProduct(product.id);"] },
  IncorrectPayment: { title: "_requirePurchasable", lines: ["if (msg.value != product.price) revert IncorrectPayment(product.price, msg.value);"] },
  PaymentFailed: { title: "_pay (push payment)", lines: ['(bool ok, ) = payable(recipient).call{value: amount}("");', "if (!ok) revert PaymentFailed(recipient);"] },
  ProductReserved: { title: "_requireNotReserved", lines: ["if (_reservations[productId].buyer != address(0)) revert ProductReserved(productId);"] },
  NotReserved: { title: "_activeReservation", lines: ["if (reservation.buyer == address(0)) revert NotReserved(productId);"] },
  NotReservationBuyer: { title: "revokeReservation", lines: ["if (reservation.buyer != msg.sender) revert NotReservationBuyer(productId, msg.sender);"] },
  ReservationExpired: { title: "confirmSale", lines: ["if (block.timestamp > reservation.expiresAt) revert ReservationExpired(productId, reservation.expiresAt);"] },
  ReservationNotExpired: { title: "expireReservation", lines: ["if (block.timestamp <= reservation.expiresAt) {", "revert ReservationNotExpired(productId, reservation.expiresAt);"] },
  NothingToWithdraw: { title: "withdraw (pull payment)", lines: ["if (amount == 0) revert NothingToWithdraw(msg.sender);"] },
  WithdrawFailed: { title: "withdraw (pull payment)", lines: ["pendingWithdrawals[msg.sender] = 0;", "if (!ok) revert WithdrawFailed(msg.sender);"] },
};
