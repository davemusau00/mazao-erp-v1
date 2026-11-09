import { createContext, useContext } from 'react';
import type { RecoveryNavigation } from './commandRecoveryRouting';

export const CommandRecoveryNavigationContext = createContext<RecoveryNavigation | null>(null);
export const useCommandRecoveryNavigation = () => useContext(CommandRecoveryNavigationContext);
