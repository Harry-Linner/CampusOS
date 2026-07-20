import type { PluginComponentProps } from "@campusos/shared";

export { manifest } from "./manifest";

export const Component = (_props: PluginComponentProps): JSX.Element => {
  return (
    <section className="page">
      <article className="panel-card">
        <h2>旧版入口已退役</h2>
        <p>本科教务、研究生教务、学在浙大和素拓将作为独立连接器接入。</p>
      </article>
    </section>
  );
};
