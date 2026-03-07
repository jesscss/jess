import React from 'react';
import OriginalDocSidebarItems from '@theme-original/DocSidebarItems';
import type Props from '@theme/DocSidebarItems';
import {useAudience, type Audience} from '@theme/AudienceContext';
import type {PropSidebarItem} from '@docusaurus/plugin-content-docs';

function getDocAudiences(docId: string | undefined): Audience[] {
  if (!docId) return ['less', 'jess', 'sass'];
  
  // Check if this is the audience-test page by docId
  if (docId === 'audience-test' || docId.includes('audience-test')) {
    return ['jess', 'less'];
  }
  
  // For now, return all audiences for other pages
  // We can add more specific logic later if needed
  return ['less', 'jess', 'sass'];
}

function filterItemsByAudience(
  items: PropSidebarItem[],
  audience: Audience
): PropSidebarItem[] {
  const out: PropSidebarItem[] = [];

  for (const item of items) {
    if (item.type === 'category') {
      const children = filterItemsByAudience(item.items, audience);
      if (children.length) {
        out.push({...item, items: children});
      }
      continue;
    }

    if (item.type === 'link') {
      // External links or generated links without a docId: always keep
      if (!('docId' in item) || !item.docId) {
        out.push(item);
        continue;
      }
      const audiences = getDocAudiences(item.docId);
      if (audiences.includes(audience)) out.push(item);
      continue;
    }

    // Handle any other item types that might have an id
    if ('id' in item && typeof item.id === 'string') {
      const audiences = getDocAudiences(item.id);
      if (audiences.includes(audience)) out.push(item);
      continue;
    }

    // Fallback (rare item kinds)
    out.push(item);
  }

  return out;
}

export default function DocSidebarItems(props: React.ComponentProps<typeof OriginalDocSidebarItems>): React.JSX.Element {
  const {audience} = useAudience(); // 'less' | 'jess' | 'sass'
  const filtered = filterItemsByAudience(props.items, audience as Audience);
  return <OriginalDocSidebarItems {...props} items={filtered} />;
}
