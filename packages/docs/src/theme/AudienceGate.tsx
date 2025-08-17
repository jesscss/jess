import React from 'react';
import {useAudience, type Audience} from './AudienceContext';

export default function AudienceGate({
  include, exclude, children,
}: { include?: Audience[]; exclude?: Audience[]; children: React.ReactNode }) {
  const {audience} = useAudience();
  if (include && !include.includes(audience)) return null;
  if (exclude && exclude.includes(audience)) return null;
  return <>{children}</>;
}