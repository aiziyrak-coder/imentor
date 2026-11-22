import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import { BOOK_CITE_HREF, linkifyLectureSources } from '../../utils/linkifyLectureSources';

type Props = {
  children: string;
};

const SOURCE_LINK_CLASS =
  'font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 break-words';

/** Kitob manbasi: qizil, havolasiz — aniq kitob va sahifa (2026-10-21). */
const BOOK_CITE_CLASS = 'font-semibold text-red-600 break-words';

/** Ma'ruza Markdown — kitob manbasi qizil matn, jurnal manbasi ko'k giperhavola. */
export default function LectureMarkdown({ children }: Props) {
  const content = useMemo(() => linkifyLectureSources(children || ''), [children]);
  return (
    <Markdown
      components={{
        a: ({ href, children: label }) =>
          href === BOOK_CITE_HREF ? (
            <span className={BOOK_CITE_CLASS}>{label}</span>
          ) : (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={SOURCE_LINK_CLASS}
          >
            {label}
          </a>
          ),
      }}
    >
      {content}
    </Markdown>
  );
}
