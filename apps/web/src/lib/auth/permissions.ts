import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

const statements = {
  ...defaultStatements,
  product: ["create", "read", "update", "archive"],
  sale: ["create", "read", "refund"],
  customer: ["create", "read", "update"],
  payment: ["read", "record", "refund"],
  inventory: ["read", "count", "validate", "adjust"],
  report: ["read"],
  business: ["read", "update"],
  expense: ["create", "read", "update"],
  supplier: ["create", "read", "update"],
  purchase: ["create", "read"],
} as const;

export const businessAccess = createAccessControl(statements);

const ownerPermissions = {
  organization: ["update"] as const,
  member: ["create", "update", "delete"] as const,
  invitation: ["create", "cancel"] as const,
  ac: ["read"] as const,
  product: ["create", "read", "update", "archive"] as const,
  sale: ["create", "read", "refund"] as const,
  customer: ["create", "read", "update"] as const,
  payment: ["read", "record", "refund"] as const,
  inventory: ["read", "count", "validate", "adjust"] as const,
  report: ["read"] as const,
  business: ["read", "update"] as const,
  expense: ["create", "read", "update"] as const,
  supplier: ["create", "read", "update"] as const,
  purchase: ["create", "read"] as const,
};

export const businessRoles = {
  owner: businessAccess.newRole(ownerPermissions),
  admin: businessAccess.newRole({ ...ownerPermissions, organization: ["update"] }),
  member: businessAccess.newRole({ organization: [], member: [], invitation: [], ac: ["read"], product: ["read"], sale: ["read"], customer: ["read"], payment: ["read"], inventory: ["read"], report: [], business: ["read"], expense: [], supplier: ["read"], purchase: ["read"] }),
  cashier: businessAccess.newRole({ organization: [], member: [], invitation: [], ac: [], product: ["read"], sale: ["create", "read"], customer: ["create", "read"], payment: ["record"], inventory: ["read"], report: [], business: [], expense: [], supplier: [], purchase: [] }),
  stock_manager: businessAccess.newRole({ organization: [], member: [], invitation: [], ac: [], product: ["create", "read", "update", "archive"], sale: ["read"], customer: ["read"], payment: [], inventory: ["read", "count", "validate", "adjust"], report: ["read"], business: [], expense: [], supplier: ["create", "read", "update"], purchase: ["create", "read"] }),
  accountant: businessAccess.newRole({ organization: [], member: [], invitation: [], ac: [], product: ["read"], sale: ["read"], customer: ["read"], payment: ["read"], inventory: ["read"], report: ["read"], business: ["read"], expense: ["create", "read", "update"], supplier: ["read"], purchase: ["read"] }),
};

export type BusinessRole = keyof typeof businessRoles;

const knownRoles = new Set<string>(Object.keys(businessRoles));

/** Evaluate the same Better Auth role grants used by the Organization plugin. */
export function hasBusinessPermission(
  roleNames: string,
  resource: keyof typeof statements,
  action: string,
): boolean {
  return roleNames.split(",").some((candidate) => {
    const roleName = candidate.trim();
    if (!knownRoles.has(roleName)) return false;
    const role = businessRoles[roleName as BusinessRole];
    const request = { [resource]: [action] } as Parameters<typeof businessRoles.owner.authorize>[0];
    return role.authorize(request).success;
  });
}
