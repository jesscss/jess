import React from 'react';
import { useAudience, type Audience } from './AudienceContext';

const audiences: {value: Audience; label: string}[] = [
  {value: 'jess', label: 'Jess'},
  {value: 'less', label: 'Less'},
  {value: 'sass', label: 'Sass+'}
];

export default function AudienceToggle(): React.JSX.Element | null {
  try {
    const {audience, setAudience} = useAudience();

    return (
    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
      <span style={{fontSize: '14px', color: 'var(--ifm-color-emphasis-600)'}}>Language:</span>
      <select
        value={audience}
        onChange={(e) => setAudience(e.target.value as Audience)}
        style={{
          padding: '4px 8px',
          border: '1px solid var(--ifm-color-emphasis-300)',
          borderRadius: '4px',
          backgroundColor: 'var(--ifm-background-color)',
          color: 'var(--ifm-color-emphasis-900)',
          fontSize: '14px'
        }}
      >
        {audiences.map(({value, label}) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
  } catch (error) {
    // Return null if context is not available
    return null;
  }
}
