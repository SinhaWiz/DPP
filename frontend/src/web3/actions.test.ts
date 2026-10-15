import { describe, expect, it } from "vitest";
import { parseEther } from "ethers";
import type { ApiProduct } from "@dpp/shared";
import { ACTIONS, actionByFn, buildCall, predict } from "./actions";

const ME = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NOW = 1_800_000_000;

const product = (over: Partial<ApiProduct> = {}): ApiProduct => ({ id: "1", name: "Laptop", owner: ME, price: "0", forSale: false, reservation: null, ...over });
const listed = (over: Partial<ApiProduct> = {}) => product({ price: parseEther("1").toString(), forSale: true, ...over });
const reservation = (buyer = OTHER, expiresAt = String(NOW + 100)) => ({ buyer, amount: parseEther("1").toString(), expiresAt });

describe("action catalogue", () => {
  it("covers every function of the market once", () => {
    expect(ACTIONS.map((a) => a.fn)).toEqual([
      "registerProduct", "listForSale", "cancelListing", "buy", "reserve", "confirmSale",
      "revokeReservation", "rejectReservation", "expireReservation", "withdraw",
    ]);
    expect(new Set(ACTIONS.map((a) => a.label)).size).toBe(ACTIONS.length);
  });
  it("marks only buy and reserve as payable, and withdraw as writing no record", () => {
    expect(ACTIONS.filter((a) => a.payable).map((a) => a.fn)).toEqual(["buy", "reserve"]);
    expect(ACTIONS.filter((a) => !a.writesRecord).map((a) => a.fn)).toEqual(["withdraw"]);
  });
});

describe("buildCall", () => {
  it("builds arguments from the form", () => {
    expect(buildCall(actionByFn("registerProduct"), { name: "Phone" }, [])).toEqual({ args: ["Phone"], value: undefined });
    expect(buildCall(actionByFn("listForSale"), { productId: "2", price: "1.5" }, [])).toEqual({ args: [2n, parseEther("1.5")], value: undefined });
    expect(buildCall(actionByFn("withdraw"), {}, [])).toEqual({ args: [], value: undefined });
  });

  it("keeps a name exactly as typed, even empty, so the contract can reject it", () => {
    expect(buildCall(actionByFn("registerProduct"), { name: "" }, []).args).toEqual([""]);
    expect(buildCall(actionByFn("registerProduct"), { name: "  x " }, []).args).toEqual(["  x "]);
  });

  it("pre-fills the payment with the listed price, unless the user types another amount", () => {
    const products = [listed()];
    expect(buildCall(actionByFn("buy"), { productId: "1" }, products).value).toBe(parseEther("1"));
    expect(buildCall(actionByFn("buy"), { productId: "1", value: "0.5" }, products).value).toBe(parseEther("0.5"));
    expect(buildCall(actionByFn("reserve"), { productId: "9" }, products).value).toBe(0n); // unknown product
  });

  it("explains unusable input", () => {
    expect(() => buildCall(actionByFn("buy"), { productId: "" }, [])).toThrow("Choose a product.");
    expect(() => buildCall(actionByFn("buy"), { productId: "abc" }, [])).toThrow("Choose a product.");
    expect(() => buildCall(actionByFn("listForSale"), { productId: "1", price: "" }, [])).toThrow("Enter price (eth).");
    expect(() => buildCall(actionByFn("listForSale"), { productId: "1", price: "lots" }, [])).toThrow("not a valid amount");
    expect(() => buildCall(actionByFn("buy"), { productId: "1", value: "x" }, [listed()])).toThrow("not a valid amount");
  });
});

describe("predict", () => {
  const p = (fn: Parameters<typeof actionByFn>[0], form: Record<string, string>, products: ApiProduct[], me: string | null = ME) =>
    predict(actionByFn(fn), buildCall(actionByFn(fn), form, products), products, me, NOW);

  it("asks who is acting, and for a complete form", () => {
    expect(predict(actionByFn("buy"), null, [], null).message).toContain("Choose who you act as");
    expect(predict(actionByFn("buy"), null, [], ME).message).toContain("Fill in the form");
    expect(predict(actionByFn("withdraw"), { args: [] }, [], ME).level).toBe("unknown");
  });

  it("registration", () => {
    expect(p("registerProduct", { name: "Phone" }, []).level).toBe("ok");
    expect(p("registerProduct", { name: "" }, []).message).toContain("EmptyName");
  });

  it("every unknown product is ProductNotFound", () => {
    for (const fn of ["listForSale", "cancelListing", "buy", "reserve", "confirmSale", "revokeReservation", "rejectReservation", "expireReservation"] as const) {
      const form = { productId: "9", price: "1" };
      expect(p(fn, form, [product()]).message, fn).toContain("ProductNotFound");
    }
  });

  it("listing: owner only, not while reserved, price above zero", () => {
    expect(p("listForSale", { productId: "1", price: "1" }, [product()]).level).toBe("ok");
    expect(p("listForSale", { productId: "1", price: "1" }, [product({ owner: OTHER })]).message).toContain("NotProductOwner");
    expect(p("listForSale", { productId: "1", price: "1" }, [product({ reservation: reservation() })]).message).toContain("ProductReserved");
    expect(p("listForSale", { productId: "1", price: "0" }, [product()]).message).toContain("InvalidPrice");
  });

  it("cancelling: owner only, only when listed, not while reserved", () => {
    expect(p("cancelListing", { productId: "1" }, [listed()]).level).toBe("ok");
    expect(p("cancelListing", { productId: "1" }, [product()]).message).toContain("NotListed");
    expect(p("cancelListing", { productId: "1" }, [listed({ owner: OTHER })]).message).toContain("NotProductOwner");
  });

  it("buying and reserving: listed, someone else's, exact price, not already reserved", () => {
    for (const fn of ["buy", "reserve"] as const) {
      const as = (products: ApiProduct[], form = { productId: "1" }, me = OTHER) => p(fn, form, products, me);
      const mine = listed({ owner: ME });
      expect(as([mine]).level, fn).toBe("ok");
      expect(as([product({ owner: ME })]).message, fn).toContain("NotListed");
      expect(as([mine], { productId: "1" }, ME).message, fn).toContain("CannotBuyOwnProduct");
      expect(as([mine], { productId: "1", value: "0.5" } as never).message, fn).toContain("IncorrectPayment");
      expect(as([listed({ reservation: reservation(ME) })]).message, fn).toContain("ProductReserved");
    }
  });

  it("confirming, rejecting, revoking and expiring a reservation", () => {
    const reserved = (expiresAt?: string) => listed({ reservation: reservation(OTHER, expiresAt) });
    expect(p("confirmSale", { productId: "1" }, [reserved()]).level).toBe("ok");
    expect(p("confirmSale", { productId: "1" }, [listed()]).message).toContain("NotReserved");
    expect(p("confirmSale", { productId: "1" }, [reserved(String(NOW - 1))]).message).toContain("ReservationExpired");
    expect(p("confirmSale", { productId: "1" }, [listed({ owner: OTHER, reservation: reservation() })]).message).toContain("NotProductOwner");

    expect(p("rejectReservation", { productId: "1" }, [reserved()]).level).toBe("ok");
    expect(p("rejectReservation", { productId: "1" }, [listed()]).message).toContain("NotReserved");

    expect(p("revokeReservation", { productId: "1" }, [reserved()], OTHER).level).toBe("ok");
    expect(p("revokeReservation", { productId: "1" }, [reserved()], ME).message).toContain("NotReservationBuyer");
    expect(p("revokeReservation", { productId: "1" }, [listed()], OTHER).message).toContain("NotReserved");

    expect(p("expireReservation", { productId: "1" }, [reserved(String(NOW - 5))]).level).toBe("ok");
    expect(p("expireReservation", { productId: "1" }, [reserved()]).message).toContain("ReservationNotExpired");
  });

  it("compares addresses without regard to case", () => {
    expect(p("listForSale", { productId: "1", price: "1" }, [product({ owner: ME.toLowerCase() })]).level).toBe("ok");
  });
});
