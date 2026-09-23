import { useCallback, useEffect, useState } from 'react';
import { currentLease, useMe } from './queries';

/**
 * Which of the resident's leases the area is showing. Someone who moved units,
 * or rents two, picks one in the switcher; the choice is remembered on this
 * device and every resident endpoint is called with that lease id.
 */

const KEY = 'resident-portal.leaseId';
const EVENT = 'resident-portal:lease';

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useResidentLease() {
  const me = useMe();
  const [chosen, setChosen] = useState<string | null>(read);

  useEffect(() => {
    const sync = () => setChosen(read());
    window.addEventListener('storage', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);

  const choose = useCallback((id: string) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    setChosen(id);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const leases = me.data?.resident?.leases ?? [];
  const lease = currentLease(me.data, chosen);
  return { lease, leases, leaseId: lease?.id ?? null, choose, me: me.data };
}
