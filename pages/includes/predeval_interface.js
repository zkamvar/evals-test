import App from "https://cdn.jsdelivr.net/gh/hubverse-org/predeval@0.0.1/dist/predeval.bundle.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

document.predeval = App;  // for debugging
document.d3m = d3;  // for debugging

function replace_chars(the_string) {
    // replace all non-alphanumeric characters, except dashes and underscores, with a dash
    return the_string.replace(/[^a-zA-Z0-9-_]/g, '-');
}

const root = "https://raw.githubusercontent.com/elray1/flusight-dashboard/refs/heads/predeval/data/";

async function _fetchData(target, eval_window, disaggregate_by) {
    // ex taskIDs: {"scenario_id": "A-2022-05-09", "location": "US"} . NB: key order not sorted
    console.info("_fetchData(): entered.", `"${target}"`, `"${eval_window}"`, `"${disaggregate_by}"`);

    // const targetKeyStr = replace_chars(targetKey);

    let target_path;
    if (disaggregate_by === '(None)') {
      target_path = `${root}scores/${target}/${eval_window}/scores.csv`;
    } else {
      target_path = `${root}scores/${target}/${eval_window}/${disaggregate_by}/scores.csv`;
    }
    return d3.csv(target_path);
    // return fetch(target_path)
    //     .then(response => response.text())
    //     .then(data => parse(data));
}


// load options and then initialize the component
fetch(`${root}/predeval-options.json`)
    .then(response => response.json())
    .then((data) => {
        console.info("fetch(): done. calling App.initialize().", data);

        // componentDiv, _fetchData, isIndicateRedraw, options, _calcUemForecasts:
        App.initialize('predEval_row', _fetchData, data);
    })
    .then(function() {
        // ZNK 2024-09-16: update for bootstrap 5
        var divs = document.querySelectorAll("div[class^='col-md']");
        for (var div of divs) {
          if (div.className.match("g-col") == null) {
            var n = div.className.match("col-md-(.{1,2})")[1];
            div.classList.add("g-col-"+n);
          }
        }
    });

window.addEventListener('DOMContentLoaded', function() {
  var divs = document.querySelectorAll("div[class^='col-md']");
  for (var div of divs) {
    if (div.className.match("g-col") == null) {
      var n = div.className.match("col-md-(.{1,2})")[1];
      div.classList.add("g-col-"+n);
    }
  }
});
