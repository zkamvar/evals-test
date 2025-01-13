/**
 * predeval: A JavaScript (ES6 ECMAScript) module for viewing forecast evaluations.
 */

// import {closestYear} from "./utils.js";
// import _validateOptions from './validation.js';
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";


//
// helper functions
//

// TODO: move to utils.js
function titleCase(str) {  // per https://stackoverflow.com/questions/196972/convert-string-to-title-case-with-javascript
    return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
}

function toLowerCaseIfString(input) {
    if (typeof input === 'string') {
        return input.toLowerCase();
    } else {
        return input;
    }
}


/**
 * `initialize()` helper that builds UI by adding DOM elements to $componentDiv. the UI is one row with two columns:
 * options on left and the table or plot on the right
 *
 * @param $componentDiv - an empty Bootstrap 4 row (JQuery object)
 * @private
 */
function _createUIElements($componentDiv) {
    //
    // helper functions for creating for rows
    //

    function _createFormRow(selectId, label) {
        return $(
            `<div class="form-row mb-2">\n` +
            `    <label for="${selectId}" class="col-sm-4 col-form-label pb-1">${label}:</label>\n` +
            `    <div class="col-sm-8">\n` +
            `        <select id="${selectId}" class="form-control"></select>\n` +
            `    </div>\n` +
            `</div>`)
    }


    //
    // make $optionsDiv (left column)
    //
    const $optionsDiv = $('<div class="col-md-3 g-col-3 border-end p-4" id="predeval_options"></div>');

    // add Outcome, task ID, and Interval selects (form). NB: these are unfilled; their <OPTION>s are added by
    // initializeTargetVarsUI(), initializeTaskIDsUI(), and initializeIntervalsUI(), respectively
    const $optionsForm = $('<form></form>');
    $optionsForm.append(_createFormRow('predeval_target', 'Target'));
    $optionsForm.append(_createFormRow('predeval_eval_window', 'Evaluation window'));
    $optionsForm.append(_createFormRow('predeval_disaggregate_by', 'Plot by'));
    // $optionsForm.append(_createFormRow('predeval_plot_type', 'Plot type'));
    $optionsForm.append(_createFormRow('predeval_metric', 'Plot metric'));
    $optionsDiv.append($optionsForm);

    //
    // make $evalDiv (right column)
    //
    const $evalDiv = $('<div class="col-md-9 g-col-9" id="predeval_main"></div>');
    $evalDiv.append($('<div id="predeval_plotly_div" style="width: 100%; height: 85vh; position: relative;"></div>'));

    //
    // finish
    //

    $componentDiv.empty().append($optionsDiv, $evalDiv);
}


const score_col_name_to_text_map = new Map(
    [
        ['model_id', 'Model'],
        ['wis', 'WIS'],
        ['wis_scaled_relative_skill', 'Rel. WIS'],
        ['ae_median', 'MAE'],
        ['ae_median_scaled_relative_skill', 'Rel. MAE'],
        ['ae_point', 'MAE'],
        ['ae_point_scaled_relative_skill', 'Rel. MAE'],
        ['se_point', 'MSE'],
        ['se_point_scaled_relative_skill', 'Rel. MSE']
    ]
)
/**
 * Converts a score column name to a human-readable string.
 * TODO: move to utils.js
 * @param {String} score_col_name - the name of a column in a scores data object
 */
function score_col_name_to_text(score_name) {
    // console.log(score_name);
    const interval_coverage_regex = new RegExp('^interval_coverage_');
    if (interval_coverage_regex.test(score_name)) {
        return `${score_name.slice(18)}\% Cov.`;
    } else {
        return score_col_name_to_text_map.get(score_name) || titleCase(score_name);
    }
}


//
// App
//

// this implements a straightforward SPA with state - based on https://dev.to/vijaypushkin/dead-simple-state-management-in-vanilla-javascript-24p0
const App = {

    //
    // non-options vars passed to `initialize()`
    //

    _fetchData: null,         // as documented in `initialize()`


    //
    // app state
    //

    state: {
        // Static data, fixed at time of creation:
        targets: [],
        eval_windows: [],
        task_id_text: {},

        // Dynamic/updated data, used to track 2 categories:
        // 1/2 Tracks UI state:
        selected_target: '',
        selected_disaggregate_by: '',
        selected_eval_window: '',
        sort_models_by: 'model_id',
        sort_models_direction: 1,
        xaxis_tickvals: [],
        // selected_plot_type: '',

        // 2/2 Data used to create tables or plots:
        scores: [],
    },

    //
    // getters
    //

    /**
     * Get the currently selected target object.
     * @returns {Object} - the target object that corresponds to the currently selected target
     * Example: {
     *   target_id: 'wk inc flu hosp',
     *   metrics: Array(6),
     *   relative_metrics: Array(2),
     *   baseline: 'FluSight-baseline',
     *   disaggregate_by: Array(4)
     * }
     */
    getSelectedTargetObj() {
        return this.state.targets.filter((obj) => obj.target_id === this.state.selected_target)[0];
    },


    //
    // initialization-related functions
    //

    /**
     * Initialize this app using the passed args. Note that we support specifying some aspects of UI selection state via
     * these URL parameters: `as_of`, `interval`, `target_var`, `model` (one or more), and task_ids (one or more). For
     * example, this URL specifies the first three along with two models and two task_ids:
     *   http://.../?as_of=2022-01-29&model=COVIDhub-baseline&model=COVIDhub-ensemble&interval=95%25&target_var=week_ahead_incident_deaths&scenario_id=1&location=48
     *
     * @param {String} componentDiv - id of a DOM node to populate. it must be an empty Bootstrap 4 row
     * @param {Function} _fetchData - function as documented in README.md .
     *   args: isForecast, targetKey, taskIDs, referenceDate
     * @param {Object} options - predeval initialization options
     * @returns {String} - error message String or null if no error
     */
    initialize(componentDiv, _fetchData, options) {
        console.debug('initialize(): entered');

        // validate componentDiv
        const componentDivEle = document.getElementById(componentDiv);
        if (componentDivEle === null) {
            throw `componentDiv DOM node not found: '${componentDiv}'`;
        }

        // save static vars
        this._fetchData = _fetchData;
        this.state.targets = options['targets'];
        this.state.eval_windows = options['eval_windows'];
        this.state.task_id_text = options['task_id_text'];

        // set initial selected state
        this.state.selected_target = options['targets'][0].target_id;
        this.state.selected_eval_window = options['eval_windows'][0].window_name;
        this.state.selected_disaggregate_by = '(None)';
        // this.state.selected_plot_type = 'Line plot';
        this.state.selected_metric = this.getSelectedTargetObj().metrics[0];

        // populate UI elements, setting selection state to initial values defined above
        const $componentDiv = $(componentDivEle);
        _createUIElements($componentDiv);
        this.initializeUI();

        // wire up UI controls (event handlers)
        this.addEventHandlers();

        // pull initial data (scores) and update the display to show first table
        this.fetchDataUpdateDisplay(true);

        return null;  // no error
    },
    initializeUI() {
        // populate options (left column)
        this.initializeTargetUI();
        this.initializeDisaggregateByUI();
        this.initializeEvalWindowUI();
        // this.initializeDisplayTypeUI();
        this.initializeMetricUI();

        // initialize plotly (right column)
        $('#predeval_plotly_div').hide();  // hide plot
        const plotyDiv = document.getElementById('predeval_plotly_div');
        const data = []  // data will be updated by `updatePlot()`
        const layout = this.getPlotlyLayout();
        Plotly.newPlot(plotyDiv, data, layout, {
            modeBarButtonsToRemove: ['lasso2d', 'autoScale2d'],
        });
    },
    initializeTargetUI() {
        // populate the target <SELECT>
        const $targetSelect = $("#predeval_target");
        const thisState = this.state;
        thisState.targets.forEach(function (target) {
            const target_id = target.target_id;
            const selected = target_id === thisState.selected_target ? 'selected' : '';
            const optionNode = `<option value="${target_id}" ${selected} >${target_id}</option>`;
            $targetSelect.append(optionNode);
        });
    },
    initializeDisaggregateByUI() {
        // populate the disaggregate <SELECT>
        // this is the "Plot by" dropdown
        const $disaggregateSelect = $("#predeval_disaggregate_by");
        const thisState = this.state;
        const selected_target_obj = this.getSelectedTargetObj();
        const disaggregate_bys = ['(None)'].concat(selected_target_obj.disaggregate_by);
        $disaggregateSelect.empty();
        disaggregate_bys.forEach(function (by) {
            const selected = by === thisState.selected_disaggregate_by ? 'selected' : '';
            const optionNode = `<option value="${by}" ${selected} >${by}</option>`;
            $disaggregateSelect.append(optionNode);
        });
    },
    initializeEvalWindowUI() {
        // populate the eval_window <SELECT>
        const $windowSelect = $("#predeval_eval_window");
        const thisState = this.state;
        this.state.eval_windows.forEach(function (window) {
            const window_name = window.window_name;
            const selected = window_name === thisState.selected_eval_window ? 'selected' : '';
            const optionNode = `<option value="${window_name}" ${selected} >${window_name}</option>`;
            $windowSelect.append(optionNode);
        });
    },
    initializeDisplayTypeUI() {
        // populate the plot type <SELECT>
        // this is a stub for future work, not currently used
        const $displaySelect = $("#predeval_display_type");
        const thisState = this.state;
        const display_types = ['Line plot', 'Heatmap'];
        display_types.forEach(function (type) {
            const selected = type === thisState.selected_display_type ? 'selected' : '';
            const optionNode = `<option value="${type}" ${selected} >${type}</option>`;
            $displaySelect.append(optionNode);
        });
    },
    initializeMetricUI() {
        // populate the metric <SELECT>
        const thisState = this.state;
        const $metricSelect = $('#predeval_metric');
        const selected_target_obj = this.getSelectedTargetObj();

        // empty because we're going to re-populate it whenever the target changes
        $metricSelect.empty();

        selected_target_obj.metrics.forEach(function (metric) {
            const selected = metric === thisState.selected_metric ? 'selected' : '';
            const optionNode = `<option value="${metric}" ${selected} >${score_col_name_to_text(metric)}</option>`;
            $metricSelect.append(optionNode);
        });
        // disable the metric select if disaggregate_by is '(None)', enable otherwise
        // TODO: probably makes sense to move this to a separate function, to separate
        // concerns of populating the UI and enabling/disabling elements
        if (thisState.selected_disaggregate_by === '(None)') {
            $metricSelect.prop("disabled", true);
        } else {
            $metricSelect.prop("disabled", false);  
        }
    },
    addEventHandlers() {
        // target, disaggregate by, eval_window, and metric selects
        $('#predeval_target').on('change', function () {
            App.state.selected_target = this.value;
            // possible values for disaggregate_by and metrics depend on the target
            App.initializeDisaggregateByUI();
            App.initializeMetricUI();

            App.fetchDataUpdateDisplay(true);
        });
        $('#predeval_disaggregate_by').on('change', function () {
            App.state.selected_disaggregate_by = this.value;
            // metric select is disabled if disaggregate_by is '(None)', enabled otherwise
            // currently, this behavior is handled in initializeMetricUI()
            App.initializeMetricUI();

            App.fetchDataUpdateDisplay(true);
        });
        $('#predeval_eval_window').on('change', function () {
            App.state.selected_eval_window = this.value;
            App.fetchDataUpdateDisplay(true);
        });
        $('#predeval_metric').on('change', function () {
            App.state.selected_metric = this.value;
            App.fetchDataUpdateDisplay(false);
        });
        // $('#predeval_display_type').on('change', function () {
        //     App.state.selected_display_type = this.value;
        //     App.fetchDataUpdateDisplay(false);
        // });
    },

    //
    // data fetch-related functions
    //

    /**
     * Updates the table or plot, optionally first fetching data.
     *
     * @param isFetchFirst true if should fetch before plotting. false if no fetch
     * @param isFetchCurrentTruth applies if isFetchFirst: controls whether current truth is fetched in addition to
     *   as_of truth and forecasts. ignored if not isFetchFirst
     */
    fetchDataUpdateDisplay(isFetchFirst) {
        if (isFetchFirst) {
            const promises = [this.fetchScores()];
            console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): waiting on promises`);
            Promise.all(promises).then((values) => {
                console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): Promise.all() done. updating display`, values);
                this.updateDisplay();
            });
        } else {
            console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): updating display`);
            this.updateDisplay();
        }
    },
    fetchScores() {
        this.state.scores = [];  // clear in case of error
        return this._fetchData(  // Promise
            this.state.selected_target,
            this.state.selected_eval_window,
            this.state.selected_disaggregate_by)
            .then((data) => {
                // convert score columns to floats
                // TODO: extract to helper function for clarity
                for (const col_name of data.columns) {
                    if (!['model_id', 'n', this.state.selected_disaggregate_by].includes(col_name)) {
                        // This is a score column, so convert values in all rows to float
                        for (let i = 0; i < data.length; i++) {
                            data[i][col_name] = parseFloat(data[i][col_name]);
                        }
                    }
                }
                this.state.scores = data;
            })
            .catch(error => console.error(`fetchScores(): error: ${error.message}`));
    },

    // update display
    updateDisplay() {
        console.log('updateDisplay(): entered');
        if (this.state.selected_disaggregate_by === '(None)') {
            this.updateTable();
        } else {
            this.updatePlot();
        }
    },

    // update display with table
    updateTable() {
        $('#predeval_plotly_div').hide();  // hide plot
        $('#predeval_table').remove();  // remove table
        const thisState = this.state;
        const $evalDiv = $('#predeval_main');
        const $table = $('<table id="predeval_table" class="table table-sm table-striped table-bordered"></table>');
        const $thead = $('<thead></thead>');
        const $tbody = $('<tbody></tbody>');
        const $tr = $('<tr></tr>');
        const $th = $('<th></th>');
        const $td = $('<td></td>');
        const interval_coverage_regex = new RegExp('^interval_coverage_');
        const relative_skill_regex = new RegExp('_scaled_relative_skill$');

        // sort scores
        // TODO: refactor to a function for sorting scores, shared with plot code
        // use of d3.ascending() and d3.descending() is verbose,
        // but it works reliably for all data types
        // (have not thoroughly explored alternatives)
        const sort_models_by = this.state.sort_models_by;
        if (this.state.sort_models_direction > 0) {
            this.state.scores.sort((a, b) => {
                return d3.ascending(toLowerCaseIfString(a[sort_models_by]),
                                    toLowerCaseIfString(b[sort_models_by]));
            });
        } else {
            this.state.scores.sort((a, b) => {
                return d3.descending(toLowerCaseIfString(a[sort_models_by]),
                                     toLowerCaseIfString(b[sort_models_by]));
            });
        }

        // add header row
        const cols = thisState.scores.columns;
        cols.forEach(function (c) {
            // set up class to use for indicating column sort status
            let c_selected = c === thisState.sort_models_by;
            let c_direction = thisState.sort_models_direction;
            let c_arrow;
            if (c_selected) {
                c_arrow = c_direction > 0 ? 'bi bi-caret-up-fill' : 'bi bi-caret-down-fill';
            } else {
                c_arrow = 'bi bi-chevron-expand';
            }

            // add header cell for this column
            $tr.append(
                $th.clone()
                    .hover(
                        function () {
                            // on hover, change background color, cursor, and arrow color
                            $(this).css('background-color', 'rgba(0,0,0,.075)')
                                .css('cursor', 'pointer');
                            $(this).find('i')
                                .addClass('text-primary');
                        },
                        function () {
                            // on exit hover, reset background color, cursor, and arrow color
                            $(this).css('background-color', '')
                                .css('cursor', 'default');
                            $(this).find('i')
                                .removeClass('text-primary');
                        }
                    )
                    .on('click', function() {
                        // click column header to sort by that column
                        App.updateTableSorting(c);
                    })
                    .text(score_col_name_to_text(c))
                    .prepend($(`<i class="bi ${c_arrow}" role="img" aria-label="Sort"></i>`))
            );
        });
        $thead.append($tr);
        $table.append($thead);

        // add data
        for (let i = 0; i < thisState.scores.length; i++) { // table rows
            const $tr = $('<tr></tr>');
            for (let j = 0; j < cols.length; j++) { // table columns
                const col_name = cols[j];
                let text_value = thisState.scores[i][col_name];
                if (col_name !== 'model_id' && col_name !== 'n') {
                    // format score columns
                    // Note: we only build tables if disaggregate_by is '(None)',
                    // so we can assume that all columns other than model_id and n are scores

                    // TODO: consider whether to make these formatting behaviors configurable
                    // TODO: consider refactor to helper function for score formatting

                    // If it's an interval coverage column, multiply by 100
                    if (interval_coverage_regex.test(col_name)) {
                        text_value *= 100;
                    }

                    // Round to 2 decimal places for relative_skill columns and 1 or all other score columns
                    if (relative_skill_regex.test(col_name)) {
                        text_value = text_value.toFixed(2);
                    } else {
                        text_value = text_value.toFixed(1);
                    }
                }
                $tr.append($td.clone().text(text_value));
            }
            $tbody.append($tr);
        }
        $table.append($tbody);

        // add table to document
        $evalDiv.append($table);
    },
    updateTableSorting(col_name) {
        // handler for column header click to sort by that column
        if (this.state.sort_models_by === col_name) {
            this.state.sort_models_direction *= -1;
        } else {
            this.state.sort_models_by = col_name;
            this.state.sort_models_direction = 1;
        }

        // updateTable performs data sort and re-renders table
        this.updateTable();
    },

    //
    // plot-related functions
    //

    /**
     * Updates the plot
     */
    updatePlot() {
        $('#predeval_table').remove();  // remove table
        $('#predeval_plotly_div').show();  // unhide the plot div
        const plotlyDiv = document.getElementById('predeval_plotly_div');

        // set the x-axis tickvals; stored in App state, determines the order of:
        // - data items created by getPlotlyData()
        // - x-axis labels created by getPlotlyLayout()
        this.setXaxisTickvals();

        // get data and layout
        const data = this.getPlotlyData();
        let layout = this.getPlotlyLayout();
        if (data.length === 0) {
            layout = {title: {text: `No score data found.`}};
        }

        // update plot
        Plotly.react(plotlyDiv, data, layout);
    },
    setXaxisTickvals() {
        // set the xaxis_tickvals property of the App state
        // used in getPlotlyLayout() and getPlotlyData()

        let all_xaxis_vals = this.state.scores.map(d => d[this.state.selected_disaggregate_by]);

        // If x axis is a task ID for which human-readable text was provided, use that text
        // TODO: refactor to a function for mapping task id values to text
        if (Object.keys(this.state.task_id_text).includes(this.state.selected_disaggregate_by)) {
            console.log('Disaggregating by task ID with text');
            const task_id_text = this.state.task_id_text[this.state.selected_disaggregate_by];
            all_xaxis_vals = all_xaxis_vals.map(d => task_id_text[d]);
        }

        // get unique values and sort
        const xaxis_tickvals_unsorted = [...new Set(all_xaxis_vals)];
        const xaxis_tickvals = xaxis_tickvals_unsorted.sort();

        // update state
        this.state.xaxis_tickvals = xaxis_tickvals;
    },
    getPlotlyLayout() {
        if (this.state.scores.length === 0) {
            return {};
        }

        // const variable = this.state.target_variables.filter((obj) => obj.value === this.state.selected_target_var)[0].plot_text;
        // const taskIdTexts = Object.values(this.selectedTaskIDs()).map(taskID => taskID['text']);
        return {
            autosize: true,
            showlegend: true,
            title: {
                text: `${score_col_name_to_text(this.state.selected_metric)} by ${this.state.selected_disaggregate_by}`,
                x: 0.5,
                y: 0.90,
                xanchor: 'center',
                yanchor: 'top',
            },
            xaxis: {
                title: {text: this.state.disaggregate_by},
                tickvals: this.state.xaxis_tickvals,
                ticktext: this.state.xaxis_tickvals,
                categoryorder: 'array',
                categoryarray: this.state.xaxis_tickvals,
                fixedrange: false
            },
            yaxis: {
                title: {text: score_col_name_to_text(this.state.selected_metric), hoverformat: '.2f'},
                fixedrange: false
            }
        }
    },
    getPlotlyData() {
        const thisState = this.state;
        let pd = [];

        if (thisState.scores.length !== 0) {
            // group by model
            const grouped = d3.group(thisState.scores, d => d.model_id);
            
            // add a line for scores for each model
            for (const [model_id, model_scores] of grouped) {
                // get x and y pairs, not sorted
                let x_unsrt = model_scores.map(d => d[thisState.selected_disaggregate_by]);
                // TODO: refactor to a function for mapping task id values to text
                if (Object.keys(thisState.task_id_text).includes(thisState.selected_disaggregate_by)) {
                    const task_id_text = thisState.task_id_text[thisState.selected_disaggregate_by];
                    x_unsrt = x_unsrt.map(d => task_id_text[d]);
                }

                const y_unsrt = model_scores.map(d => d[thisState.selected_metric]);
                let x_y = x_unsrt.map((val, i) => [val, y_unsrt[i]]);

                // sort (x, y) pairs in order of this.state.xaxis_tickvals
                x_y.sort((a, b) => thisState.xaxis_tickvals.indexOf(a[0]) - thisState.xaxis_tickvals.indexOf(b[0]));
                const x = x_y.map(d => d[0]);
                const y = x_y.map(d => d[1]);

                // object for Plotly
                const line_data = {
                    x: x,
                    y: y,
                    mode: 'lines+markers',
                    type: 'scatter',
                    name: model_id,
                    hovermode: false,
                    opacity: 0.7,
                    // line: {color: state.colors[index]},
                };
                pd.push(line_data);
            }
        }

        return pd
    },
};


export default App;  // export the module's main entry point