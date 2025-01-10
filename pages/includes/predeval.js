/**
 * predeval: A JavaScript (ES6 ECMAScript) module for viewing forecast evaluations.
 */

// import {closestYear} from "./utils.js";
// import _validateOptions from './validation.js';
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";


//
// helper functions
//

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

    function titleCase(str) {  // per https://stackoverflow.com/questions/196972/convert-string-to-title-case-with-javascript
        return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
    }

    function _createFormRow(selectId, label) {
        return $(
            `<div class="form-row">\n` +
            `    <label for="${selectId}" class="col-sm-4 col-form-label">${label}:</label>\n` +
            `    <div class="col-sm-8">\n` +
            `        <select id="${selectId}" class="form-control"></select>\n` +
            `    </div>\n` +
            `</div>`)
    }


    //
    // make $optionsDiv (left column)
    //
    const $optionsDiv = $('<div class="col-md-3" id="predeval_options"></div>');

    // add Outcome, task ID, and Interval selects (form). NB: these are unfilled; their <OPTION>s are added by
    // initializeTargetVarsUI(), initializeTaskIDsUI(), and initializeIntervalsUI(), respectively
    const $optionsForm = $('<form></form>');
    $optionsForm.append(_createFormRow('predeval_target', 'Target'));
    $optionsForm.append(_createFormRow('predeval_disaggregate_by', 'Disaggregate by'));
    $optionsForm.append(_createFormRow('predeval_eval_window', 'Evaluation window'));
    // $optionsForm.append(_createFormRow('predeval_display_type', 'Display type'));
    $optionsForm.append(_createFormRow('predeval_metric', 'Metric'));
    $optionsDiv.append($optionsForm);

    //
    // make $evalDiv (right column)
    //
    const $evalDiv = $('<div class="col-md-9" id="predeval_main"></div>');
    $evalDiv.append($('<div id="predeval_plotly_div" style="width: 100%; height: 72vh; position: relative;"></div>'));

    //
    // finish
    //
    $componentDiv.empty().append($optionsDiv, $evalDiv);
}


/**
 * Shows a modal dialog with a close button.
 *
 * @param {String} - title
 * @param {String} - message
 */
function showDialog(title, message) {
    console.log(`flashMessage(): ${message}`);
    const modal$ = $(`
        <div class="modal fade" id="showDialogModal" tabindex="-1" role="dialog" aria-labelledby="showDialogModalLabel" aria-hidden="true">
          <div class="modal-dialog" role="document">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="showDialogModalLabel">${title}</h5>
                <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div class="modal-body">${message}</div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
              </div>
            </div>
          </div>
        </div>`);
    modal$.modal('show');
}



const score_col_name_to_text_map = new Map(
    [
        ['model_id', 'Model'],
        ['wis', 'WIS'],
        ['wis_relative_skill', 'Rel. WIS'],
        ['wis_scaled_relative_skill', 'Rel. WIS'],
        ['ae_median', 'MAE'],
        ['ae_median_relative_skill', 'Rel. MAE'],
        ['ae_median_scaled_relative_skill', 'Rel. MAE'],
        ['ae_point', 'MAE'],
        ['ae_point_relative_skill', 'Rel. MAE'],
        ['ae_point_scaled_relative_skill', 'Rel. MAE'],
        ['se_point', 'MSE'],
        ['se_point_relative_skill', 'Rel. MSE'],
        ['se_point_scaled_relative_skill', 'Rel. MSE']
    ]
)
/**
 * Converts a score column name to a human-readable string.
 * TODO: move to utils.js
 * @param {String} score_col_name - the name of a column in a scores data object
 */
function score_col_name_to_text(score_name) {
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

    isIndicateRedraw: false,  // true if app should set plot opacity when loading data
    _fetchData: null,         // as documented in `initialize()`


    //
    // app state
    //

    state: {
        // Static data, fixed at time of creation:
        targets: {},
        eval_windows: [],
        task_id_text: [],

        // Dynamic/updated data, used to track 2 categories:
        // 1/2 Tracks UI state:
        selected_target: '',
        selected_disaggregate_by: '',
        selected_eval_window: '',
        // selected_display_type: '',

        // 2/2 Data used to create tables or plots:
        scores: [],
    },

    //
    // getters
    //
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
     * @param {Object} options - evaluation initialization options
     * @returns {String} - error message String or null if no error
     */
    initialize(componentDiv, _fetchData, options) {
        this._fetchData = _fetchData;

        console.debug('initialize(): entered');

        // validate componentDiv
        const componentDivEle = document.getElementById(componentDiv);
        if (componentDivEle === null) {
            throw `componentDiv DOM node not found: '${componentDiv}'`;
        }

        // validate options object
        // try {
        //     _validateOptions(options);
        //     console.debug('initialize(): passed options are valid');
        // } catch (error) {
        //     console.error(`invalid option(s): ${error}`);
        //     showDialog('Init failed due to invalid option(s)', error);
        //     return error;  // leave display default/blank
        // }

        // save static vars
        this.state.targets = options['targets'];
        this.state.eval_windows = options['eval_windows'];
        this.state.task_id_text = options['task_id_text'];

        // save initial selected state
        this.state.selected_target = options['initial_target'];
        this.state.selected_eval_window = options['initial_eval_window'];
        this.state.selected_disaggregate_by = '(None)';
        // this.state.selected_display_type = 'Table';
        this.state.selected_metric = this.getSelectedTargetObj().metrics[0];

        // populate UI elements, setting selection state to initial
        const $componentDiv = $(componentDivEle);
        _createUIElements($componentDiv);
        this.initializeUI();

        // wire up UI controls (event handlers)
        this.addEventHandlers();

        // pull initial data (scores) and update the plot
        this.fetchDataUpdateDisplay(true);

        return null;  // no error
    },
    initializeUI() {
        // populate options and models list (left column)
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
        // populate the target <SELECT>
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
        // populate the target <SELECT>
        const $displaySelect = $("#predeval_display_type");
        const thisState = this.state;
        const display_types = ['Table', 'Line plot'];
        // $targetVarsSelect.empty();
        display_types.forEach(function (type) {
            const selected = type === thisState.selected_display_type ? 'selected' : '';
            const optionNode = `<option value="${type}" ${selected} >${type}</option>`;
            $displaySelect.append(optionNode);
        });
    },
    initializeMetricUI() {
        const thisState = this.state;
        const $metricSelect = $('#predeval_metric');
        const selected_target_obj = this.getSelectedTargetObj();
        $metricSelect.empty();
        selected_target_obj.metrics.forEach(function (metric) {
            const selected = metric === thisState.selected_metric ? 'selected' : '';
            const optionNode = `<option value="${metric}" ${selected} >${metric}</option>`;
            $metricSelect.append(optionNode);
        });
        if (thisState.selected_display_type === 'Table') {
            $metricSelect.prop("disabled", true);
        } else {
            $metricSelect.prop("disabled", false);  
        }
    },
    addEventHandlers() {
        // target, disaggregate by,  selects
        $('#predeval_target').on('change', function () {
            App.state.selected_target = this.value;
            App.initializeDisaggregateByUI();
            App.fetchDataUpdateDisplay(true);
        });
        $('#predeval_disaggregate_by').on('change', function () {
            App.state.selected_disaggregate_by = this.value;
            App.fetchDataUpdateDisplay(true);
        });
        $('#predeval_eval_window').on('change', function () {
            App.state.selected_eval_window = this.value;
            App.fetchDataUpdateDisplay(true);
        });
        // $('#predeval_display_type').on('change', function () {
        //     App.state.selected_display_type = this.value;
        //     App.initializeMetricUI();
        //     App.fetchDataUpdateDisplay(false);
        // });
    },

    // Returns information about the task ID <SELECT>(s) as an object similar to format of `task_ids` except that each
    // value is the selected object, rather than a list of all possible task IDs. Example return value:
    // { "scenario_id": {"value": "2", "text": "scenario 2"},  "location": {"value": "48", "text": "Texas"} }
    selectedTaskIDs() {
        const theSelectedTaskIDs = {};  // return value. filled next
        Object.keys(this.state.task_ids).forEach(taskIdKey => {
            const $taskIdSelect = $(`#${taskIdKey}`);  // created by _createUIElements()
            const selectedTaskIdValue = $taskIdSelect.val();
            const taskIdObj = App.state.task_ids[taskIdKey].find(taskID => taskID['value'] === selectedTaskIdValue);
            theSelectedTaskIDs[taskIdKey] = taskIdObj;
        });
        return theSelectedTaskIDs;
    },
    /**
     * A fetch*() helper that returns a processed version of selectedTaskIDs() in the format of `initial_task_ids`. for
     * example, if selectedTaskIDs() = {"scenario_id": {"value": "1", "text": "scenario 1"}, "location": {"value": "48", "text": "Texas"}},
     * then this function returns {"scenario_id": "1", "location": "48"} .
     */
    selectedTaskIDValues() {
        const taskIdVals = {};
        for (const [taskID, taskIDObj] of Object.entries(this.selectedTaskIDs())) {
            taskIdVals[taskID] = taskIDObj['value'];
        }
        return taskIdVals;
    },

    //
    // date fetch-related functions
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
                console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): Promise.all() done. updating plot`, values);
                this.updateDisplay();
            });
        } else {
            console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): updating plot`);
            this.updateDisplay();
        }
    },
    fetchScores() {
        this.state.scores = [];  // clear in case of error
        return this._fetchData(  // Promise
            this.state.selected_target, this.state.selected_eval_window, this.state.selected_disaggregate_by)
            // .then(response => response.json())  // Promise
            .then((data) => {
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
        $('#predeval_plotly_div').hide();  // clear plot
        $('#predeval_table').remove();  // clear table
        const thisState = this.state;
        const $evalDiv = $('#predeval_main');
        const $table = $('<table id="predeval_table" class="table table-sm table-striped table-bordered"></table>');
        const $thead = $('<thead></thead>');
        const $tbody = $('<tbody></tbody>');
        const $tr = $('<tr></tr>');
        const $th = $('<th></th>');
        const $td = $('<td></td>');
        const interval_coverage_regex = new RegExp('^interval_coverage_');

        // add header row
        const cols = thisState.scores.columns;
        cols.forEach(function (c) {
            $tr.append($th.clone().text(score_col_name_to_text(c)));
        });
        $thead.append($tr);
        $table.append($thead);

        // add data
        for (let i = 0; i < thisState.scores.length; i++) { // table rows
            const $tr = $('<tr></tr>');
            for (let j = 0; j < cols.length; j++) { // table columns
                const col_name = cols[j];
                let text_value = thisState.scores[i][col_name];
                if (col_name !== 'model_id') {
                    // This is a score column, so convert to float
                    text_value = parseFloat(text_value);

                    // TODO: consider whether to make the formatting behaviors configurable

                    // If it's an interval coverage column, multiply by 100
                    if (interval_coverage_regex.test(col_name)) {
                        text_value *= 100;
                    }

                    // For all score columns, round to 1 decimal place
                    text_value = text_value.toFixed(1);
                }
                $tr.append($td.clone().text(text_value));
            }
            $tbody.append($tr);
        }
        $table.append($tbody);

        // replace existing table
        $evalDiv.append($table);
    },

    //
    // plot-related functions
    //

    /**
     * Updates the plot
     */
    updatePlot() {
        $('#predeval_table').remove();  // clear table
        $('#predeval_plotly_div').show();  // clear plot
        const plotlyDiv = document.getElementById('predeval_plotly_div');
        const data = this.getPlotlyData();
        let layout = this.getPlotlyLayout();
        if (data.length === 0) {
            layout = {title: {text: `No score data found.`}};
        }

        Plotly.react(plotlyDiv, data, layout);
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
                text: `${this.state.selected_metric} by ${this.state.selected_disaggregate_by}`,
                x: 0.5,
                y: 0.90,
                xanchor: 'center',
                yanchor: 'top',
            },
            xaxis: {
                title: {text: this.state.disaggregate_by},
                fixedrange: false
            },
            yaxis: {
                title: {text: this.state.selected_metric, hoverformat: '.2f'},
                fixedrange: false
            }
        }
    },
    getPlotlyData() {
        const thisState = this.state;
        let pd = [];

        console.log('in getPlotlyData()');
        if (thisState.scores.length !== 0) {
            // group by model
            const grouped = d3.group(thisState.scores, d => d.model_id);
            
            // add a line for scores for each model
            for (const [model_id, model_scores] of grouped) {
                const x = model_scores.map(d => d[thisState.selected_disaggregate_by]);
                const y = model_scores.map(d => d[thisState.selected_metric]);
                const line_data = {
                    x: x,
                    y: y,
                    mode: 'lines',
                    type: 'scatter',
                    name: model_id,
                    hovermode: false,
                    opacity: 0.7,
                    // line: {color: state.colors[index]},
                    // hoverinfo: 'none'
                };
                pd.push(line_data);
            }
        }

        // done!
        return pd
    },
};


export default App;  // export the module's main entry point