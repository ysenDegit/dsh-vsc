    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    var BACKTICK = String.fromCharCode(96);
    var LF = String.fromCharCode(10);
    var NUL = String.fromCharCode(0);
    var BS = String.fromCharCode(92);

    function leadingIndent(s) {
      var n = 0;
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch === ' ') n++;
        else if (ch === String.fromCharCode(9)) n += 2;
        else break;
      }
      return n;
    }

    function parseListMarker(line) {
      var indent = leadingIndent(line);
      var rest = line.slice(indent);
      if (!rest) return null;
      var ch = rest.charAt(0);
      if ((ch === '-' || ch === '*' || ch === '+') && rest.charAt(1) === ' ') {
        return { indent: indent, marker: ch, ordered: false, content: rest.slice(2) };
      }
      var j = 0;
      while (j < rest.length && rest.charAt(j) >= '0' && rest.charAt(j) <= '9') j++;
      if (j > 0 && (rest.charAt(j) === '.' || rest.charAt(j) === ')') && rest.charAt(j + 1) === ' ') {
        return { indent: indent, marker: rest.slice(0, j + 1), ordered: true, content: rest.slice(j + 2) };
      }
      return null;
    }

    function parseFence(line) {
      var t = line.trim();
      if (t.length < 3) return null;
      var ch = t.charAt(0);
      if (ch !== BACKTICK && ch !== '~') return null;
      var n = 0;
      while (n < t.length && t.charAt(n) === ch) n++;
      if (n < 3) return null;
      return { marker: t.slice(0, n), lang: t.slice(n).trim() };
    }

    function isFenceClose(line, marker) {
      var t = line.trim();
      if (t.charAt(0) !== marker.charAt(0)) return false;
      if (t.length < marker.length) return false;
      for (var i = 0; i < t.length; i++) {
        if (t.charAt(i) !== marker.charAt(0)) return false;
      }
      return true;
    }

    function parseHeading(line) {
      var t = line.trim();
      var level = 0;
      while (level < 6 && t.charAt(level) === '#') level++;
      if (level > 0 && t.charAt(level) === ' ') {
        return { level: level, text: t.slice(level + 1).trim() };
      }
      return null;
    }

    function isHr(line) {
      var t = line.trim();
      if (t.length < 3) return false;
      var ch = t.charAt(0);
      if (ch !== '-' && ch !== '*' && ch !== '_') return false;
      for (var i = 0; i < t.length; i++) {
        if (t.charAt(i) !== ch) return false;
      }
      return true;
    }

    function blockquoteContent(line) {
      var t = line.trim();
      t = t.slice(1);
      if (t.charAt(0) === ' ') t = t.slice(1);
      return t;
    }

    function highlightCode(code, lang) {
      var s = escapeHtml(code);
      var placeholders = [];
      s = s.replace(/(&quot;.*?&quot;)/g, function (m) {
        var idx = placeholders.length;
        placeholders.push('<span class="tok-string">' + m + '</span>');
        return NUL + 'ph' + idx + 'ph' + NUL;
      });
      s = s.replace(/(&#39;.*?&#39;)/g, function (m) {
        var idx = placeholders.length;
        placeholders.push('<span class="tok-string">' + m + '</span>');
        return NUL + 'ph' + idx + 'ph' + NUL;
      });
      var lines = s.split(LF);
      var commented = [];
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var ci = line.indexOf('//');
        if (ci < 0) ci = line.indexOf('#');
        if (ci >= 0) {
          var cidx = placeholders.length;
          placeholders.push('<span class="tok-comment">' + line.slice(ci) + '</span>');
          commented.push(line.slice(0, ci) + NUL + 'ph' + cidx + 'ph' + NUL);
        } else {
          commented.push(line);
        }
      }
      s = commented.join(LF);
      var keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'import', 'export', 'from', 'new', 'try', 'catch', 'async', 'await', 'def', 'lambda', 'yield', 'break', 'continue', 'switch', 'case', 'throw', 'typeof', 'instanceof', 'in', 'of'];
      for (var k = 0; k < keywords.length; k++) {
        var kw = keywords[k];
        var re = new RegExp(BS + 'b' + kw + BS + 'b', 'g');
        s = s.replace(re, function () {
          var idx = placeholders.length;
          placeholders.push('<span class="tok-keyword">' + kw + '</span>');
          return NUL + 'ph' + idx + 'ph' + NUL;
        });
      }
      var numRe = new RegExp(BS + 'b(' + BS + 'd+' + BS + '.?' + BS + 'd*)' + BS + 'b', 'g');
      s = s.replace(numRe, function (m, num) {
        var idx = placeholders.length;
        placeholders.push('<span class="tok-number">' + num + '</span>');
        return NUL + 'ph' + idx + 'ph' + NUL;
      });
      for (var j = 0; j < placeholders.length; j++) {
        s = s.split(NUL + 'ph' + j + 'ph' + NUL).join(placeholders[j]);
      }
      return s;
    }

    function renderLatex(tex) {
      var s = escapeHtml(tex);
      var greek = {
        alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
        eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
        nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
        tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
        Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
        Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
      };
      for (var g in greek) {
        s = s.split(BS + g + ' ').join(greek[g] + ' ');
        s = s.split(BS + g).join(greek[g]);
      }
      var supRe = new RegExp(BS + '^' + BS + '{([^{}]+)}', 'g');
      s = s.replace(supRe, '<sup>$1</sup>');
      var supSimpleRe = new RegExp(BS + '^([A-Za-z0-9])', 'g');
      s = s.replace(supSimpleRe, '<sup>$1</sup>');
      var subRe = new RegExp(BS + '_' + BS + '{([^{}]+)}', 'g');
      s = s.replace(subRe, '<sub>$1</sub>');
      var subSimpleRe = new RegExp(BS + '_([A-Za-z0-9])', 'g');
      s = s.replace(subSimpleRe, '<sub>$1</sub>');
      var fracRe = new RegExp(BS + BS + 'frac' + BS + '{([^{}]+)}' + BS + '{([^{}]+)}', 'g');
      s = s.replace(fracRe, '<span class="frac"><span class="frac-top">$1</span><span class="frac-bottom">$2</span></span>');
      var sqrtRe = new RegExp(BS + BS + 'sqrt' + BS + '{([^{}]+)}', 'g');
      s = s.replace(sqrtRe, '<span class="sqrt">√<span class="sqrt-body">$1</span></span>');
      var ops = { times: '×', cdot: '·', pm: '±', le: '≤', ge: '≥', neq: '≠', infty: '∞', to: '→', rightarrow: '→', sum: '∑', int: '∫', prod: '∏' };
      for (var op in ops) {
        s = s.split(BS + op).join(ops[op]);
      }
      s = s.split(BS + ',').join(' ');
      s = s.split(BS + ';').join(' ');
      s = s.split(BS + 'quad').join(' ');
      s = s.split(BS + 'qquad').join(' ');
      s = s.split(BS + 'left').join('');
      s = s.split(BS + 'right').join('');
      return s;
    }

    function renderMathSpans(text) {
      var s = text;
      var DOLLAR = BS + '$';
      var blockRe = new RegExp(DOLLAR + DOLLAR + '([^$' + LF + ']+)' + DOLLAR + DOLLAR, 'g');
      s = s.replace(blockRe, function (m, tex) {
        return '<span class="math-block">' + renderLatex(tex) + '</span>';
      });
      var inlineRe = new RegExp(DOLLAR + '([^$' + LF + ']+)' + DOLLAR, 'g');
      s = s.replace(inlineRe, function (m, tex) {
        return '<span class="math-inline">' + renderLatex(tex) + '</span>';
      });
      return s;
    }

    function renderInline(text) {
      var raw = String(text || '');
      var parts = raw.split(BACKTICK);
      var mixed = '';
      var codePlaceholders = [];
      for (var i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          var idx = codePlaceholders.length;
          codePlaceholders.push('<code>' + escapeHtml(parts[i]) + '</code>');
          mixed += NUL + idx + NUL;
        } else {
          mixed += parts[i];
        }
      }
      var s = escapeHtml(mixed);
      s = renderMathSpans(s);
      s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, '<img alt="$1" src="$2">');
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, '<a href="$2">$1</a>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, '$1<em>$2</em>');
      s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
      s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      for (var j = 0; j < codePlaceholders.length; j++) {
        s = s.split(NUL + j + NUL).join(codePlaceholders[j]);
      }
      return s;
    }

    function splitTableRow(line) {
      var s = line.trim();
      if (s.charAt(0) === '|') s = s.slice(1);
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
      return s.split('|').map(function (cell) { return cell.trim(); });
    }

    function renderTable(lines, start) {
      var headers = splitTableRow(lines[start]);
      var aligns = splitTableRow(lines[start + 1]);
      if (!headers.length || headers.length !== aligns.length) return null;
      var alignVals = [];
      for (var a = 0; a < aligns.length; a++) {
        if (!/^:?-+:?$/.test(aligns[a])) return null;
        if (aligns[a].charAt(0) === ':' && aligns[a].charAt(aligns[a].length - 1) === ':') alignVals.push('center');
        else if (aligns[a].charAt(aligns[a].length - 1) === ':') alignVals.push('right');
        else if (aligns[a].charAt(0) === ':') alignVals.push('left');
        else alignVals.push('');
      }
      var html = '<table><thead><tr>';
      for (var h = 0; h < headers.length; h++) {
        html += '<th' + (alignVals[h] ? ' style="text-align:' + alignVals[h] + '"' : '') + '>' + renderInline(headers[h]) + '</th>';
      }
      html += '</tr></thead><tbody>';
      var r = start + 2;
      while (r < lines.length && lines[r].trim() !== '' && lines[r].indexOf('|') >= 0) {
        var cells = splitTableRow(lines[r]);
        html += '<tr>';
        for (var c = 0; c < headers.length; c++) {
          html += '<td' + (alignVals[c] ? ' style="text-align:' + alignVals[c] + '"' : '') + '>' + renderInline(cells[c] || '') + '</td>';
        }
        html += '</tr>';
        r++;
      }
      html += '</tbody></table>';
      return { html: html, next: r };
    }

    function renderList(lines, start) {
      var first = parseListMarker(lines[start]);
      if (!first) return { html: '', next: start };
      var baseIndent = first.indent;
      var html = '<' + (first.ordered ? 'ol' : 'ul') + '>';
      var i = start;
      while (i < lines.length) {
        var m = parseListMarker(lines[i]);
        if (!m) break;
        if (m.indent < baseIndent) break;
        if (m.indent > baseIndent) break;
        if (m.ordered !== first.ordered) break;
        var content = m.content;
        i++;
        var inner = [];
        while (i < lines.length) {
          var sub = lines[i];
          if (sub.trim() === '') {
            var look = i + 1;
            while (look < lines.length && lines[look].trim() === '') look++;
            if (look >= lines.length) { i = look; break; }
            var lookIndent = leadingIndent(lines[look]);
            var lookList = parseListMarker(lines[look]);
            if (lookList && lookIndent === baseIndent) { i = look; break; }
            if (lookIndent > baseIndent) { inner.push(''); i++; continue; }
            i = look;
            break;
          }
          if (leadingIndent(sub) > baseIndent) {
            inner.push(sub.slice(baseIndent));
            i++;
          } else {
            break;
          }
        }
        html += '<li>' + renderInline(content);
        if (inner.length) html += renderMarkdown(inner.join(LF));
        html += '</li>';
      }
      html += '</' + (first.ordered ? 'ol' : 'ul') + '>';
      return { html: html, next: i };
    }

    function renderMarkdown(text) {
      var lines = String(text || '').split(LF);
      var out = [];
      var i = 0;
      while (i < lines.length) {
        var line = lines[i];
        var fence = parseFence(line);
        if (fence) {
          i++;
          var codeLines = [];
          while (i < lines.length) {
            if (isFenceClose(lines[i], fence.marker)) { i++; break; }
            codeLines.push(lines[i]);
            i++;
          }
          out.push('<pre><code' + (fence.lang ? ' class="language-' + escapeHtml(fence.lang) + '"' : '') + '>' + highlightCode(codeLines.join(LF), fence.lang) + '</code></pre>');
          continue;
        }
        if (line.trim().charAt(0) === '>') {
          var quoteLines = [];
          while (i < lines.length && lines[i].trim().charAt(0) === '>') {
            quoteLines.push(blockquoteContent(lines[i]));
            i++;
          }
          out.push('<blockquote>' + renderMarkdown(quoteLines.join(LF)) + '</blockquote>');
          continue;
        }
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && lines[i + 1].indexOf('-') >= 0) {
          var table = renderTable(lines, i);
          if (table) { out.push(table.html); i = table.next; continue; }
        }
        var heading = parseHeading(line);
        if (heading) {
          out.push('<h' + heading.level + '>' + renderInline(heading.text) + '</h' + heading.level + '>');
          i++;
          continue;
        }
        if (isHr(line)) {
          out.push('<hr>');
          i++;
          continue;
        }
        var listMarker = parseListMarker(line);
        if (listMarker) {
          var list = renderList(lines, i);
          if (list.html) { out.push(list.html); i = list.next; continue; }
        }
        if (line.trim() === '') { i++; continue; }
        var para = [];
        while (i < lines.length && lines[i].trim() !== ''
          && !parseHeading(lines[i])
          && !parseListMarker(lines[i])
          && !parseFence(lines[i])
          && lines[i].trim().charAt(0) !== '>'
          && !isHr(lines[i])) {
          para.push(lines[i]);
          i++;
        }
        out.push('<p>' + renderInline(para.join(LF)) + '</p>');
      }
      return out.join('');
    }

