(function(exports) {
  if (typeof console === 'undefined') {
    var noop = function() {};
    console = {
      log: noop,
      warn: noop,
      debug: noop,
      error: noop
    };
  }

  // for IE9: History API polyfill
  var location = window.history.location || window.location;
  // TODO: if location.hash, read that
  // e.g. if an IE9 user sends a link to a Chrome user, they should see the
  // same stuff.

  var search = d3.select("#search"),
      form = new formdb.Form(search.node()),
      inputs = search.selectAll("*[name]"),
      formatPrice = d3.format(",.0f"),
      formatCommas = d3.format(","),
      api = new hourglass.API(),
      $search = $("#labor_category"),
      resultsTable = d3.select("#results-table")
        .style("display", "none"),
      sortHeaders = resultsTable.selectAll("thead th")
        .call(setupColumnHeader),
      loadingIndicator = search.select(".loading-indicator"),
      request;

  // JFYI
  var HISTOGRAM_BINS = 12;

  form.on("submit", function onsubmit(data, e) {
    e.preventDefault();
    submit(true);
  });

   /*
   * For some reason, the browser's native form reset isn't working.
   * So instead of just listening for a "reset" event and submitting,
   * we hijack the click event on the reset button and reset the form
   * manually.
   */
  search.select('input[type="reset"]')
    .on('click', function reset() {
      form.reset();
      // NB: form.reset() doesn't reset hidden inputs,
      // so we need to do it ourselves.
      search.selectAll('input[type="hidden"]')
        .property('value', '');
      console.log("reset:", form.getData());
      submit(true);
      d3.event.preventDefault();
    });

  inputs.on("change", function onchange() {
    submit(true);
  });

  d3.selectAll('a.merge-params')
    .on('click', function() {
      d3.event.preventDefault();
      var query = this.getAttribute('href'),
          params = hourglass.qs.parse(query);
      // console.log('merging:', query, params);
      for (var key in params) {
        form.set(key, params[key]);
      }
      submit(true);
    });

  initialize();

  window.addEventListener("popstate", popstate);

  function initialize() {
    popstate();

    var autoCompReq;
    $search.autoComplete({
      minChars: 2,
      delay: 5,
      cache: true,
      source: function(term, done) {
        // console.log("search:", term);
        if (autoCompReq) autoCompReq.abort();
        var data = form.getData();
        autoCompReq = api.get({
          uri: "search/",
          data: {
            q: term,
            query_type: data.query_type
          },
        }, function(error, result) {
          autoCompReq = null;
          if (error) return done([]);
          var categories = result.slice(0, 20).map(function(d) {
            return {
              term: d.labor_category,
              count: d.count
            };
          });
          return done(categories);
        });
      },
      renderItem: function(item, search) {
        var re = new RegExp("(" + search.split(" ").join("|") + ")", "gi"),
            term = item.term || item;
        return [
          '<div class="autocomplete-suggestion" data-val="' + term + '">',
            '<span class="term">', term.replace(re, "<b>$1</b>"), '</span>',
            '<span class="count">', item.count, '</span>',
          '</div>'
        ].join("");
      }
    });
  }

  function popstate() {
    // read the query string and set values accordingly
    var data = hourglass.extend(
      form.getData(),
      hourglass.qs.parse(location.search)
    );
    inputs.on("change", null);
    form.setData(data);
    inputs.on("change", function onchange() {
      submit(true);
    });

    var sort = parseSortOrder(data.sort);
    var sortable = function(d) { return d.sortable; };
    sortHeaders
      .filter(sortable)
      .classed("sorted", function(d) {
        return d.sorted = (d.key === sort.key);
      })
      .classed("descending", function(d) {
        return d.descending = (d.sorted && sort.order === "-");
      });
    updateSortOrder(sort.key);

    submit(false);
  }

  function submit(pushState) {
    var data = form.getData();
    inputs
      .filter(function() {
        return this.type !== 'radio' && this.type !== 'checkbox';
      })
      .classed("filter_active", function() {
        return !!this.value;
      });

    console.log("submitting:", data);

    search.classed("loaded", false);
    search.classed("loading", true);

    // cancel the outbound request if there is one
    if (request) request.abort();
    var defaults = {
      histogram: HISTOGRAM_BINS
    };
    request = api.get({
      uri: "rates/",
      data: hourglass.extend(defaults, data)
    }, update);


    d3.select("#export-data")
      .attr("href", function() {
        return [
          this.href.split("?").shift(),
          hourglass.qs.format(data)
        ].join("?");
      });

    if (pushState) {
      var href = "?" + hourglass.qs.format(data)
      history.pushState(null, null, href);
    }

    updateExcluded();
  }

  function update(error, res) {
    search.classed("loading", false);
    request = null;

    if (error) {
      if (error === "abort") {
        // ignore aborts
        return;
      }

      search.classed("error", true);

      loadingIndicator.select(".error-message")
        .text(error);

      console.error('request error:', error);
    } else {
      search.classed("error", false);
    }

    console.log("update:", res);
    search.classed("loaded", true);

    updateDescription(res);

    if (res && res.results && res.results.length) {
      // updatePriceRange(res);
      updatePriceHistogram(res);
      updateResults(res);
    } else {
      res = EMPTY_DATA;
      // updatePriceRange(EMPTY_DATA);
      updatePriceHistogram(res);
      updateResults(res);
    }
  }

  function updatePriceRange(data) {
    var priceScale = d3.scale.linear()
      .domain([data.minimum, data.maximum])
      .range([0, 100]);

    var graph = d3.select("#price-range");

    graph.select(".min")
      .call(setPrice, data.minimum);
    graph.select(".max")
      .call(setPrice, data.maximum);
    graph.select(".average")
      .call(setPrice, data.average)
      .style("left", priceScale(data.average) + "%");

    function setPrice(selection, price) {
      selection.select(".value")
        .text(formatPrice(price));
    }
  }

  var histogramUpdated = false,
      EMPTY_DATA = {
        minimum: 0,
        maximum: .001,
        average: 0,
        count: 0,
        results: [],
        wage_histogram: [
          {count: 0, min: 0, max: 0}
        ]
      };
  function updatePriceHistogram(data) {
    var width = 640,
        height = 200,
        pad = [30, 15, 60, 60],
        top = pad[0],
        left = pad[3],
        right = width - pad[1],
        bottom = height - pad[2],
        svg = d3.select("#price-histogram")
          .attr("viewBox", [0, 0, width, height].join(" "))
          .attr("preserveAspectRatio", "xMinYMid meet"),
        formatDollars = function(n) {
          return "$" + formatPrice(n);
        };

    var extent = [data.minimum, data.maximum],
        bins = data.wage_histogram,
        x = d3.scale.linear()
          .domain(extent)
          .range([left, right]),
        countExtent = d3.extent(bins, function(d) { return d.count; }),
        heightScale = d3.scale.linear()
          .domain([0].concat(countExtent))
          .range([0, 1, bottom - top]);
    console.log('count extent:', countExtent);

    d3.select("#avg-price-highlight")
      .text(formatDollars(data.average));

    var xAxis = svg.select(".axis.x");
    if (xAxis.empty()) {
      xAxis = svg.append("g")
        .attr("class", "axis x");
    }

    var yAxis = svg.select(".axis.y");
    if (yAxis.empty()) {
      yAxis = svg.append("g")
        .attr("class", "axis y");
    }

    var gBar = svg.select("g.bars");
    if (gBar.empty()) {
      gBar = svg.append("g")
        .attr("class", "bars");
    }

    var avg = svg.select("g.avg"),
        avgOffset = -8;
    if (avg.empty()) {
      avg = svg.append("g")
        .attr("class", "avg");
      var avgText = avg.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", avgOffset - 6);
      avgText.append("tspan")
        .attr("class", "value average");
      avgText.append("tspan")
        .text(" average");
      avg.append("line");
      avg.append("circle")
        .attr("cy", avgOffset)
        .attr("r", 3);
    }

    avg.select("line")
      .attr("y1", avgOffset)
      .attr("y2", bottom - top + 8); // XXX tick size = 6
    avg.select(".value")
      .text(formatDollars(data.average));

    var bars = gBar.selectAll(".bar")
      .data(bins);

    bars.exit().remove();

    var enter = bars.enter().append("g")
      .attr("class", "bar");
    enter.append("title");

    var step = (right - left) / bins.length;
    enter.append("rect")
      .attr("x", function(d, i) {
        return left + i * step;
      })
      .attr("y", bottom)
      .attr("width", step)
      .attr("height", 0);

    var title = templatize("{count} results from {min} to {max}");
    bars.select("title")
      .text(function(d, i) {
        var inclusive = (i === bins.length - 1),
            sign = inclusive ? "<=" : "<";
        return title({
          count: formatCommas(d.count),
          min: formatDollars(d.min),
          sign: sign,
          max: formatDollars(d.max)
        });
      });

    var t = histogramUpdated
      ? svg.transition().duration(500)
      : svg;

    t.select(".avg")
      .attr("transform", "translate(" + [~~x(data.average), top] + ")");

    t.selectAll(".bar")
      .each(function(d) {
        d.x = x(d.min);
        d.width = x(d.max) - d.x;
        d.height = heightScale(d.count);
        d.y = bottom - d.height;
      })
      .select("rect")
        .attr("x", function(d, i) { return d.x; })
        .attr("y", function(d, i) { return d.y; })
        .attr("height", function(d, i) { return d.height; })
        .attr("width", function(d, i) { return d.width; });

    var ticks = bins.map(function(d) { return d.min; })
      .concat([data.maximum]);

    var xa = d3.svg.axis()
      .orient("bottom")
      .scale(x)
      .tickValues(ticks)
      .tickFormat(function(d, i) {
        return (i === 0 || i === bins.length)
          ? formatDollars(d)
          : formatPrice(d);
      });
    xAxis.call(xa)
      .attr("transform", "translate(" + [0, bottom + 2] + ")")
      .selectAll(".tick")
        .classed("primary", function(d, i) {
          return i === 0 || i === bins.length;
        })
        .select("text")
          .classed("min", function(d, i) {
            return i === 0;
          })
          .classed("max", function(d, i) {
            return i === bins.length;
          })
          .style("text-anchor", "end")
          .attr("transform", "rotate(-35)");

    xAxis.append('text')
      .attr('class', 'label')
      .attr('transform', 'translate(' + [left + (right - left) / 2, 45] + ')')
      .attr('text-anchor', 'middle')
      .text('Price (hourly rate)')

    var yd = d3.extent(heightScale.domain());
    var ya = d3.svg.axis()
      .orient("left")
      .scale(d3.scale.linear()
        .domain(yd)
        .range([bottom, top]))
      .tickValues(yd);
    ya.tickFormat(formatCommas);
    yAxis.call(ya)
      .attr("transform", "translate(" + [left - 2, 0] + ")");

    yAxis.append('text')
      .attr('class', 'label')
      .attr('transform', 'translate(' + [-25, height / 2 - 15] + ') rotate(-90)')
      .attr('text-anchor', 'middle')
      .text('# of results')

    histogramUpdated = true;
  }

  function updateResults(data) {
    var results = data.results;
    d3.select('#results-count')
      .text(formatCommas(data.count));

    resultsTable.style('display', null);

    var thead = resultsTable.select('thead'),
        columns = thead.selectAll('th').data(),
        tbody = resultsTable.select('tbody');

    var tr = tbody.selectAll('tr')
      .data(results);

    tr.exit().remove();

    tr.enter().append('tr')
    .on('mouseover', function(d) {
      var label = this.querySelector('.years');
      label.className = label.className.replace('hidden', '');
    })
    .on('mouseout', function(d) {
      var label = this.querySelector('.years');
      label.className = label.className + ' hidden';
    });

    var td = tr.selectAll('.cell')
      .data(function(d) {
        return columns.map(function(column) {
          var key = column.key,
              value = d[key];
          return {
            column: column,
            row: d,
            key: key,
            value: value,
            string: column.format(value)
          };
        });
      });

    td.exit().remove();

    var sortKey = parseSortOrder(form.getData().sort).key;

    var enter = td.enter()
        .append(function(d, i) {
          var name = d.column.key === 'labor_category' ? 'th' : 'td';
          return document.createElement(name);
        })
        .attr("class", function(d) {
          return 'cell column-' + d.key;
        })
        .classed('collapsed', function(d) {
          return d.column.collapsed;
        })
        .classed("sorted", function(c) {
          return c.column.key === sortKey;
        });

    enter.filter(function() { return this.nodeName === 'TH'; })
      .attr('scope', 'row');

    // update the HTML of all cells (except exclusion columns)
    td.filter(function(d) {
      return d.key !== 'exclude';
    })
    .html(function(d) {
      // don't just do "if !(d.string)" because 0 is valid
      if (d.string === null) {
        d.string = 'N/A';
      }

      return d.column.collapsed ? "" : d.string;
    });

    // add "years" the experience number, shown on row hover
    td.filter(function(d) {
      return d.key === 'min_years_experience';
    })
    .html(function(d) {
      var label = d.string === 1 ? 'year' : 'years';
      return d.string + ' <span class="years hidden">' + label + '</span>';
    });

    // add links to contracts
    td.filter(function(d) {
      return d.key === 'idv_piid';
    })
    .html(function(d) {
      var id = d.string.split('-').join('');
      return '<a target="_blank" href="https://www.gsaadvantage.gov/ref_text/' 
             + id + '/' + id + '_online.htm">' + d.string
             + '<img class="document-icon" src="/static/hourglass_site/images/document.svg" alt="document icon"></a>';
    });

    // add a link to incoming exclusion cells
    enter.filter(function(d) {
      return d.key === 'exclude';
    })
    .append('a')
      .attr('class', 'exclude-row')
      .html('&times;');


    // update the links on all exclude cells
    td.filter(function(d) {
      return d.key === 'exclude';
    })
    .select('a')
      .attr('href', function(d) {
        return '?exclude=' + d.row.id;
      })
      .attr('title', function(d){
          return 'Exclude ' + d.row.labor_category + ' from your search';
      })

      .on('click', function(d) {
        d3.event.preventDefault();
        /*
         * XXX this is where d3.select(this).parent('tr')
         * would be nice...
         */
        var tr = this.parentNode.parentNode;
        // console.log('removing:', tr);
        tr.parentNode.removeChild(tr);

        excludeRow(d.row.id);
      });
  }

  function excludeRow(id) {
    id = String(id);
    var excluded = getExcludedIds();
    if (excluded.indexOf(id) === -1) {
      excluded.push(id);
    } else {
      console.warn('attempted to exclude an already excluded row:', id);
    }
    form.set('exclude', excluded.join(','));
    submit(true);
  }

  function getExcludedIds() {
    var str = form.get('exclude');
    return str && str.length
      ? str.split(',')
      : [];
  }

  function updateExcluded() {
    var excluded = getExcludedIds(),
        len = excluded.length,
        rows = 'row' + (len === 1 ? '' : 's'),
        text = len > 0
          ? ['★ Restore', len, rows].join(' ')
          : '';
    d3.select('#restore-excluded')
      .style('display', len > 0
        ? null
        : 'none')
      .attr('title', rows + ': ' + excluded.join(', '))
      .text(text);
  }

  function setupColumnHeader(headers) {
    headers
      .datum(function() {
        return {
          key: this.getAttribute('data-key'),
          title: this.getAttribute('title') || this.textContent,
          format: getFormat(this.getAttribute('data-format')),
          sortable: this.classList.contains('sortable'),
          collapsible: this.classList.contains('collapsible')
        };
      })
      .each(function(d) {
        this.classList.add('column-' + d.key);
      });

    headers.filter(function(d) { return d.collapsible; })
      .call(setupCollapsibleHeaders);

    headers.filter(function(d) { return d.sortable; })
      .call(setupSortHeaders);
  }

  function setupSortHeaders(headers) {
    headers
      .each(function(d) {
        d.sorted = false;
        d.descending = false;
      })
      .attr('tabindex', 0)
      .attr('aria-role', 'button')
      .on('click.sort', setSortOrder);

    function setSortOrder(d, i) {
      // console.log('sort:', d.key);
      headers.each(function(c, j) {
        if (j !== i) {
          c.sorted = false;
          c.descending = false;
        }
      });

      if (d.sorted) {
        d.descending = !d.descending;
      }
      d.sorted = true;

      var sort = (d.descending ? '-' : '') + d.key;
      form.set('sort', sort);

      updateSortOrder(d.key);

      submit(true);
    }
  }

  function updateSortOrder(key) {
    var title = function(d) {
      if (d.sorted) {
        var order = d.descending ? 'descending' : 'ascending';
        var other = d.descending ? 'ascending' : 'descending';
        return [d.title, ': sorted ', order, ', select to sort ', other].join('');
      } else {
        return d.title + ': select to sort ascending';
      }
    };

    sortHeaders
      .filter(function(d) { return d.sortable; })
        .classed('sorted', function(c) {
          return c.sorted;
        })
        .classed('ascending', function(c) {
          return c.sorted && !c.descending;
        })
        .classed('descending', function(c) {
          return c.sorted && c.descending;
        })
        // .attr('aria-label', title)
        .attr('title', title);

    resultsTable.selectAll('tbody td')
      .classed('sorted', function(c) {
        return c.column.key === key;
      });
  }

  function setupCollapsibleHeaders(headers) {
    headers
      .each(function(d) {
        d.collapsed = this.classList.contains("collapsed");
        d.label = this.innerText;
      })
      .append("a")
        .attr("class", "toggle-collapse")
        .on("click.collapse", function(d) {
          // console.log("collapse:", d.key);
          d3.event.preventDefault();
          d3.event.stopImmediatePropagation();
          d.collapsed = !d.collapsed;
          updateCollapsed.apply(this.parentNode, arguments);
        });

    headers.each(updateCollapsed)

    function updateCollapsed(d) {
      var title = [
        d.collapsed ? "Show" : "Hide",
        d.label,
        d.collapsed ? "▼" : ""
      ].join(" ");

      d3.select(this)
        .classed("collapsed", d.collapsed)
        .select("a.toggle-collapse")
          .attr("title", title)
          .text(title);

      resultsTable.selectAll("td.column-" + d.key)
        .classed("collapsed", d.collapsed)
        .html(d.collapsed
          ? ""
          : function(d) { return d.string; });
    }
  }

  function parseSortOrder(order) {
    if (!order) return {key: null, order: null};
    var first = order.charAt(0),
        sort = {order: ""};
    switch (first) {
      case "-":
        sort.order = first;
        order = order.substr(1);
        break;
    }
    sort.key = order;
    return sort;
  }

  function showError(error) {
    alert(error);
  }

  function getFormat(spec) {
    if (!spec) return function(d) { return d; };

    if (spec.indexOf("{}") > -1) {
      return function(d) {
        return spec.replace(/{}/g, d)
          .replace(/\?{(.+)}/g, d == 1 ? "" : "$1");
      };
    }

    var index = spec.indexOf("%");
    if (index === -1) {
      return d3.format(spec);
    }
    var prefix = spec.substr(0, index),
        format = d3.format(spec.substr(index + 1));
    return function(str) {
      if (!str) return "";
      return prefix + format(+str);
    };
  }

  function updateDescription(res) {
    var total = res ? formatCommas(res.count) : '0',
        data = form.getData();

    /*
     * build a list of inputs that map to
     * descriptive filters. The 'name' key is the
     * 'name' attribute of the corresponding input,
     * and the 'template' key is an HTML string
     * suitable for use with templatize(), which
     * replaces {key} with d[key] for the input.
     */
    var inputs = ([
      {name: 'q', template: '&ldquo;<a>{value}</a>&rdquo;'},
      {name: 'min_education', template: 'minimum education level: <a>{label}</a>'},
      {name: 'experience_range', template: '<a>{label}</a> of experience'},
      {name: 'site', template: 'worksite: <a>{value}</a>'},
      {name: 'business_size', template: 'size: <a>{label}</a>'},
      {name: 'schedule', template: 'schedule: <a>{value}</a>'}
    ])
    .map(function(d) {
      d.value = data[d.name];
      d.ref = document.getElementsByName(d.name)[0];
      d.active = !!d.value;
      if (d.active) {
        var ref = d.ref;
        d.label = ref.nodeName === 'SELECT'
          ? getRefLabel(ref)
          : d.value;
      }
      return d;
    });

    function getRefLabel(select) {
      var option = select.options[select.selectedIndex];
      return option.getAttribute('data-label') || option.text;
    }

    // key/value pairs for generic descriptive
    // elements
    var keys = {
      total: total,
      count: formatCommas(res.results.length),
      results: 'result' + (total === 1 ? '' : 's')
    };

    var desc = d3.select('#description');
    // update all of the generic descriptive elements
    desc.selectAll('[data-key]')
      .datum(function() {
        return this.getAttribute('data-key');
      })
      .text(function(key) {
        return keys[key] || '';
      });

    // get only the active inputs
    var filters = inputs.filter(function(d) {
      return d.active;
    });

    // build the filters list
    var f = desc.select('.filters')
      .classed('empty', !filters.length)
      .selectAll('.filter')
      .data(filters);
    f.exit().remove();
    f.enter().append('span')
      .attr('class', 'filter')
      .attr('data-name', function(d) {
        return d.name;
      });

    // update the HTML for each filter
    var flen = filters.length,
        multiple = flen > 1,
        last = flen - 1;
    f.html(function(d, i) {
      // add a comma between filters, and the word
      // 'and' for the last one
      var comma = (i > 0 && flen > 2 && i !== last) ? ', ' : ' ',
          and = comma + ((multiple && i === last)
            ? 'and '
            : ''),
          tmpl = templatize(and + d.template);
      // XXX we should never see "???"
      return tmpl(d, '???');
    })
    .select('a')
      .attr('href', '#')
      .classed('focus-input', true)
      .on('click', function(d) {
        d3.event.preventDefault();
        d.ref.focus();
        return false;
      });
  }

  function templatize(str, undef) {
    undef = d3.functor(undef);
    return function(d) {
      return str.replace(/{(\w+)}/g, function(_, key) {
        return d[key] || undef.call(d, key);
      });
    };
  }

})(this);
