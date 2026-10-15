import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Role } from "@dpp/shared";

const RolesContext = createContext<Map<string, Role>>(new Map());

/** Makes role names ("Retailer") available to every <Address> below it. */
export function RolesProvider({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const map = useMemo(() => new Map(roles.map((r) => [r.address.toLowerCase(), r])), [roles]);
  return <RolesContext.Provider value={map}>{children}</RolesContext.Provider>;
}

export function useRole(address: string | null | undefined): Role | undefined {
  const map = useContext(RolesContext);
  return address ? map.get(address.toLowerCase()) : undefined;
}

export function useRoles(): Role[] {
  return [...useContext(RolesContext).values()];
}
