export default function PlaceholderPanel({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <div className="content">
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="sub">Em construção</div>
      </div>
      <div className="empty-state">
        <p>{note}</p>
      </div>
    </div>
  );
}
