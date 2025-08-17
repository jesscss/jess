import React from 'react';
import {AudienceProvider} from './AudienceContext';

export default function Root({children}: {children: React.ReactNode}) {
  return (
    <AudienceProvider>
      {children}
    </AudienceProvider>
  );
}