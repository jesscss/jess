import React, {createContext, useContext, useEffect, useState} from 'react';

export type Audience = 'less' | 'jess' | 'sass';

interface AudienceContextType {
  audience: Audience;
  setAudience: (audience: Audience) => void;
}

const AudienceContext = createContext<AudienceContextType>({
  audience: 'jess',
  setAudience: () => {}
});

export const AudienceProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [audience, setAudience] = useState<Audience>('jess');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem('audience') as Audience;
    if (saved && ['less', 'jess', 'sass'].includes(saved)) {
      setAudience(saved);
    }
  }, []);

  useEffect(() => {
    if (isClient) {
      localStorage.setItem('audience', audience);
    }
  }, [audience, isClient]);

  return (
    <AudienceContext.Provider value={{audience, setAudience}}>
      {children}
    </AudienceContext.Provider>
  );
};

export const useAudience = () => useContext(AudienceContext);