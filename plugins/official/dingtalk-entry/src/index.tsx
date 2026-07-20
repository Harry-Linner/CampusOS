import type { PluginComponentProps } from "@campusos/shared";

export { manifest } from "./manifest";

export const Component = (_props: PluginComponentProps): JSX.Element => {
  return (
    <section className="page">
      <article className="panel-card">
        <h2>钉钉入口占位</h2>
        <p>当前只保留入口和架构挂点，不展开具体导入实现。</p>
      </article>
    </section>
  );
};
