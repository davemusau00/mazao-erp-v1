export interface CustomerPresentationAccount {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  creditLimitMinor: string;
  balanceMinor: string;
  status: 'ACTIVE' | 'SUSPENDED';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CustomerFilter = 'all' | 'debtors' | 'good_standing' | 'suspended';

export function summarizeCustomers(customers: CustomerPresentationAccount[]) {
  const totalBalanceMinor = customers.reduce((sum, customer) => sum + BigInt(customer.balanceMinor), 0n);
  const totalCreditLimitMinor = customers.reduce((sum, customer) => sum + BigInt(customer.creditLimitMinor), 0n);
  const debtors = customers.filter(customer => BigInt(customer.balanceMinor) > 0n).length;
  const suspended = customers.filter(customer => customer.status === 'SUSPENDED').length;
  const utilizationTenths = totalCreditLimitMinor > 0n
    ? (totalBalanceMinor * 1000n / totalCreditLimitMinor).toString()
    : null;
  return { totalBalanceMinor, totalCreditLimitMinor, debtors, suspended, utilizationTenths };
}

export function filterCustomers(customers: CustomerPresentationAccount[], search: string, filter: CustomerFilter) {
  const query = search.trim().toLocaleLowerCase();
  return customers.filter(customer => {
    const matchesSearch = !query || `${customer.name} ${customer.phone} ${customer.email ?? ''}`.toLocaleLowerCase().includes(query);
    if (!matchesSearch) return false;
    if (filter === 'debtors') return BigInt(customer.balanceMinor) > 0n;
    if (filter === 'good_standing') return BigInt(customer.balanceMinor) === 0n;
    if (filter === 'suspended') return customer.status === 'SUSPENDED';
    return true;
  });
}
