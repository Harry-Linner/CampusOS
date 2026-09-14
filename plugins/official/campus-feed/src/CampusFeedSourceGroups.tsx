import { Fragment, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { FeedSourceDescriptor } from "@campusos/shared";

/** A website is a disclosure; subscribing always targets an explicit column. */
export const CampusFeedSourceGroups = ({ sources, renderSource, expanded = false }: {
  sources: FeedSourceDescriptor[];
  expanded?: boolean;
  renderSource: (source: FeedSourceDescriptor) => ReactNode;
}): JSX.Element => {
  const groups = new Map<string, FeedSourceDescriptor[]>();
  for (const source of sources) {
    const key = source.site ? `site:${source.site.id}` : source.id;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return <>{[...groups].map(([key, entries]) => entries[0].site
    ? <details className="campus-feed-site" key={key} open={expanded}>
      <summary className="campus-feed-site-heading">
        <ChevronDown size={16} aria-hidden="true" />
        <span><strong>{entries[0].site.name}</strong><span className="campus-feed-site-topics">{[...new Set(entries.flatMap(source => source.tags))].join(" · ")}</span></span>
        <span className="campus-feed-site-count">{entries.length} 个栏目</span>
      </summary>
      <div className="campus-feed-site-columns">{entries.map(source => <Fragment key={source.id}>{renderSource(source)}</Fragment>)}</div>
    </details>
    : <Fragment key={key}>{renderSource(entries[0])}</Fragment>)}</>;
};
