import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, type BackendCommand } from '../services/apiClient';

/** A workspace cannot start writes until its actor/assignment journal was read. */
export function useCommandRecoveryReadiness(prefix: string, onRestore: (command: BackendCommand) => void, allowedTypes?: readonly string[]) {
  const session = apiClient.getSession()!;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const readyRef = useRef(false), inFlight = useRef(false), generation = useRef(0);
  const restore = useRef(onRestore);
  restore.current = onRestore;
  const inspect = useCallback(async () => {
    const request = ++generation.current;
    readyRef.current = false;
    setReady(false); setError('');
    try {
      const records = await apiClient.listRecoverableCommands(session.tenant.id);
      if (request !== generation.current) return;
      const retained = records.filter(record => record.command.type.startsWith(prefix) && (!allowedTypes || allowedTypes.includes(record.command.type)) && record.command.deviceId === session.deviceId)
        .sort((a, b) => a.savedAt.localeCompare(b.savedAt))[0];
      if (retained) restore.current(retained.command);
      readyRef.current = true;
      setReady(true);
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Saved command recovery could not be read.');
    }
  }, [prefix, allowedTypes, session.tenant.id, session.user.id, session.deviceId]);
  useEffect(() => { void inspect(); return () => { ++generation.current; readyRef.current = false; }; }, [inspect]);
  const begin = () => {
    if (!readyRef.current || inFlight.current) return false;
    inFlight.current = true;
    return true;
  };
  return { ready, error, inspect, begin, finish: () => { inFlight.current = false; }, inFlight };
}
