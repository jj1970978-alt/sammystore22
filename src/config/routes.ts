import { ReactNode } from 'react';
import Dashboard from '@/pages/Dashboard';
import Accounts from '@/pages/Accounts';
import Numbers from '@/pages/Numbers';
import AllNumbers from '@/pages/AllNumbers';
import Pricing from '@/pages/Pricing';
import FundWallet from '@/pages/FundWallet';
import ReferEarn from '@/pages/ReferEarn';
import AccountHistory from '@/pages/AccountHistory';
import NumbersHistory from '@/pages/NumbersHistory';
import TransactionHistory from '@/pages/TransactionHistory';
import ApiTools from '@/pages/ApiTools';
import ContactUs from '@/pages/ContactUs';

export type SectionType =
  | 'dashboard'
  | 'accounts'
  | 'numbers'
  | 'allnumbers'
  | 'pricing'
  | 'fund'
  | 'refer'
  | 'accounthistory'
  | 'numbershistory'
  | 'txhistory'
  | 'api'
  | 'contact';

export interface RouteConfig {
  path: string;
  section: SectionType;
  component: ReactNode;
  label: string;
}

export const ROUTES: RouteConfig[] = [
  { path: '/', section: 'dashboard', component: Dashboard, label: 'Dashboard' },
  { path: '/accounts', section: 'accounts', component: Accounts, label: 'Accounts' },
  { path: '/numbers', section: 'numbers', component: Numbers, label: 'Numbers' },
  { path: '/allnumbers', section: 'allnumbers', component: AllNumbers, label: 'All Numbers' },
  { path: '/pricing', section: 'pricing', component: Pricing, label: 'Pricing' },
  { path: '/fund', section: 'fund', component: FundWallet, label: 'Fund Wallet' },
  { path: '/refer', section: 'refer', component: ReferEarn, label: 'Refer & Earn' },
  { path: '/accounthistory', section: 'accounthistory', component: AccountHistory, label: 'Account History' },
  { path: '/numbershistory', section: 'numbershistory', component: NumbersHistory, label: 'Numbers History' },
  { path: '/txhistory', section: 'txhistory', component: TransactionHistory, label: 'Transaction History' },
  { path: '/api', section: 'api', component: ApiTools, label: 'API Tools' },
  { path: '/contact', section: 'contact', component: ContactUs, label: 'Contact Us' },
];

export const getRouteByPath = (path: string): RouteConfig | undefined => {
  // Exact match first
  let match = ROUTES.find(r => r.path === path);
  if (match) return match;
  
  // Then try startsWith for nested routes
  match = ROUTES.find(r => path.startsWith(r.path));
  return match;
};

export const getRouteBySection = (section: SectionType): RouteConfig | undefined => {
  return ROUTES.find(r => r.section === section);
};

export const getSectionFromPath = (path: string): SectionType => {
  const route = getRouteByPath(path);
  return route?.section ?? 'dashboard';
};
