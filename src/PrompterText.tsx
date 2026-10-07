import { sentences, type Cursor, type Paragraph } from './script';

/** The operator and presenter render the same script and highlight semantics. */
export default function PrompterText({ paragraphs, cursor, labels = true }: { paragraphs: Paragraph[]; cursor: Cursor; labels?: boolean }) {
  return <>{paragraphs.map((paragraph, index) => {
    const chunks = sentences(paragraph.text);
    const nextIndex = chunks.findIndex(chunk => cursor.offset < chunk.end);
    const activeIndex = nextIndex < 0 ? chunks.length - 1 : nextIndex;
    return <article key={paragraph.id} data-paragraph={index} className={`script-paragraph ${index < cursor.paragraph ? 'past' : ''} ${index === cursor.paragraph ? 'current' : 'future'}`}>
      {labels && <div className="paragraph-label"><span>{String(index + 1).padStart(2, '0')}</span>{index === cursor.paragraph ? '当前段落' : index < cursor.paragraph ? '已读段落' : '接下来'}</div>}
      <p>{chunks.map((chunk, s) => <span key={chunk.start} data-sentence-start={chunk.start} data-active-line={index === cursor.paragraph && s === activeIndex ? 'true' : undefined} className={index === cursor.paragraph && s === activeIndex ? 'current-sentence' : ''}>{chunk.text}</span>)}</p>
    </article>;
  })}</>;
}
