import React from 'react';
import OriginalNavbarItem from '@theme-original/NavbarItem';
import AudienceToggle from '../AudienceToggle';

export default function NavbarItem(props: any): React.JSX.Element {
  if (props.type === 'custom-audience-toggle') {
    try {
      return <AudienceToggle />;
    } catch (error) {
      // Fallback if context is not available
      return <></>;
    }
  }
  return <OriginalNavbarItem {...props} />;
} 
