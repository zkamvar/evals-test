/**
 * predeval: A JavaScript (ES6 ECMAScript) module for viewing forecast evaluations.
 */

// import {closestYear} from "./utils.js";
// import _validateOptions from './validation.js';


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
    $optionsForm.append(_createFormRow('predeval_display_type', 'Display type'));
    $optionsDiv.append($optionsForm);

    //
    // make $evalDiv (right column)
    //
    const $evalDiv = $('<div class="col-md-9" id="predeval_main"></div>');

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
        display_type: 'table',

        // 2/2 Data used to create tables or plots:
        scores: [],
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
        this.state.selected_disaggregate_by = '(None)';
        this.state.selected_eval_window = options['initial_eval_window'];
        this.state.selected_display_type = 'table';

        // populate UI elements, setting selection state to initial
        console.debug('initialize(): initializing UI');
        const $componentDiv = $(componentDivEle);
        _createUIElements($componentDiv);
        this.initializeUI();

        // wire up UI controls (event handlers)
        this.addEventHandlers();

        // pull initial data (scores) and update the plot
        console.debug('initialize(): fetching data and updating display');
        this.fetchDataUpdateDisplay(true);

        console.debug('initialize(): done');
        return null;  // no error
    },
    initializeUI() {
        // populate options and models list (left column)
        this.initializeTargetUI();
        this.initializeDisaggregateByUI();
        this.initializeEvalWindowUI();
        this.initializeDisplayTypeUI();

        // initialize plotly (right column)
        // const plotyDiv = document.getElementById('ploty_div');
        // const data = []  // data will be update by `updatePlot()`
        // const layout = this.getPlotlyLayout();
        // Plotly.newPlot(plotyDiv, data, layout, {
        //     modeBarButtonsToRemove: ['lasso2d', 'autoScale2d'],
        // });
    },
    initializeTargetUI() {
        // populate the target <SELECT>
        const $targetSelect = $("#predeval_target");
        const thisState = this.state;
        console.log(thisState.targets);
        thisState.targets.forEach(function (target) {
            console.log(target);
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
        const selected_target_obj = thisState.targets.filter((obj) => obj.target_id === thisState.selected_target)[0];
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
    addEventHandlers() {
        // target, disaggregate by,  selects
        $('#predeval_target').on('change', function () {
            App.state.selected_target = this.value;
            this.initializeDisaggregateByUI();
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
        $('#predeval_display_type').on('change', function () {
            App.state.selected_display_type = this.value;
            App.fetchDataUpdateDisplay(false);
        });
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
     * Updates the plot, optionally first fetching data.
     *
     * @param isFetchFirst true if should fetch before plotting. false if no fetch
     * @param isFetchCurrentTruth applies if isFetchFirst: controls whether current truth is fetched in addition to
     *   as_of truth and forecasts. ignored if not isFetchFirst
     */
    fetchDataUpdateDisplay(isFetchFirst) {
        if (isFetchFirst) {
            const promises = [this.fetchScores()];
            console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): waiting on promises`);
            // const $plotyDiv = $('#ploty_div');
            // if (this.isIndicateRedraw) {
            //     $plotyDiv.fadeTo(0, 0.25);
            // }
            Promise.all(promises).then((values) => {
                console.debug(`fetchDataUpdateDisplay(${isFetchFirst}): Promise.all() done. updating plot`, values);
                this.updateDisplay();
                // this.updateDisplay(isResetYLimit);
                // if (this.isIndicateRedraw) {
                //     $plotyDiv.fadeTo(0, 1.0);
                // }
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
        if (this.state.selected_display_type === 'table') {
            this.updateTable();
        } else {
            this.updatePlot();
        }
    },

    // update display with table
    updateTable() {
        const thisState = this.state;
        const $evalDiv = $('#predeval_main');
        const $table = $('<table id="predeval_table class="table table-sm table-striped table-bordered"></table>');
        const $thead = $('<thead></thead>');
        const $tbody = $('<tbody></tbody>');
        const $tr = $('<tr></tr>');
        const $th = $('<th></th>');
        const $td = $('<td></td>');

        // add header row
        const header = thisState.scores[0];
        header.forEach(function (h) {
            $tr.append($th.clone().text(h));
        });
        $thead.append($tr);
        $table.append($thead);

        // add data rows
        thisState.scores.slice(1).forEach(function (scores_row) {
            const $tr = $('<tr></tr>');
            scores_row.forEach(function (score) {
                $tr.append($td.clone().text(score));
            });
            $tbody.append($tr);
        });
        $table.append($tbody);

        // replace existing table
        $evalDiv.empty().append($table);
    },

    //
    // plot-related functions
    //

    /**
     * Updates the plot, preserving any current xaxis range limit, and optionally any current yaxis range limit
     *
     * @param isResetYLimit true if should reset any yaxis range limit currently set
     */
    updatePlot(isResetYLimit) {
        const plotyDiv = document.getElementById('ploty_div');
        const data = this.getPlotlyData();
        let layout = this.getPlotlyLayout();
        if (data.length === 0) {
            layout = {title: {text: `No Visualization Data Found for ${this.state.selected_as_of_date}`}};
        }

        // before updating the plot we store the xaxis and yaxis ranges so that we can relayout using them if need be.
        // NB: the default xaxis.range seems to be [-1, 6] when updating for the first time (yaxis.range = [-1, 4]).
        // there might be a better way to determine this.
        let currXAxisRange;
        let currYAxisRange;
        let isXAxisRangeDefault;
        let isYAxisRangeDefault;
        if (plotyDiv.data.length !== 0) {  // we have data to plot. o/w plotyDiv.layout.* is undefined
            currXAxisRange = plotyDiv.layout.xaxis.range;
            currYAxisRange = plotyDiv.layout.yaxis.range;
            isXAxisRangeDefault = ((currXAxisRange.length === 2) && (currXAxisRange[0] === -1) && (currXAxisRange[1] === 6));
            isYAxisRangeDefault = ((currYAxisRange.length === 2) && (currYAxisRange[0] === -1) && (currYAxisRange[1] === 4));
        }
        Plotly.react(plotyDiv, data, layout);
        if (plotyDiv.data.length !== 0) {  // we have data to plot. o/w plotyDiv.layout.* is undefined
            if (!isXAxisRangeDefault) {
                Plotly.relayout(plotyDiv, 'xaxis.range', currXAxisRange);
            } else if (this.state.initial_xaxis_range != null) {
                Plotly.relayout(plotyDiv, 'xaxis.range', this.state.initial_xaxis_range);
            }

            if (!isResetYLimit) {
                if (!isYAxisRangeDefault) {
                    Plotly.relayout(plotyDiv, 'yaxis.range', currYAxisRange);
                } else if (this.state.initial_yaxis_range != null) {
                    Plotly.relayout(plotyDiv, 'yaxis.range', this.state.initial_yaxis_range);
                }
            }
        }
        this.initializeDateRangePicker();  // b/c jquery binding is apparently lost with any Plotly.*() call
    },
    getPlotlyLayout() {
        if (this.state.target_variables.length === 0) {
            return {};
        }

        const variable = this.state.target_variables.filter((obj) => obj.value === this.state.selected_target_var)[0].plot_text;
        const taskIdTexts = Object.values(this.selectedTaskIDs()).map(taskID => taskID['text']);
        return {
            autosize: true,
            showlegend: false,
            title: {
                text: `Forecasts of ${variable} <br> in ${taskIdTexts.join(', ')} as of ${this.state.selected_as_of_date}`,
                x: 0.5,
                y: 0.90,
                xanchor: 'center',
                yanchor: 'top',
            },
            xaxis: {
                title: {text: 'Date'},
                rangeslider: {},
            },
            yaxis: {
                title: {text: variable, hoverformat: '.2f'},
                fixedrange: false
            }
        }
    },
    getPlotlyData() {
        const state = this.state;
        let pd = [];
        if (state.selected_truth.includes('Current Target') && Object.keys(state.current_truth).length !== 0) {
            pd.push({
                x: state.current_truth.date,
                y: state.current_truth.y,
                type: 'scatter',
                mode: 'lines',
                name: 'Current Target',
                marker: {color: 'darkgray'}
            })
        }
        if (state.selected_truth.includes('Target as of') && Object.keys(state.as_of_truth).length !== 0) {
            pd.push({
                x: state.as_of_truth.date,
                y: state.as_of_truth.y,
                type: 'scatter',
                mode: 'lines',
                opacity: 0.5,
                name: `Target as of ${state.selected_as_of_date}`,
                marker: {color: 'black'}
            })
        }

        let pd0 = []
        if (state.forecasts.length !== 0) {
            // add the line for predictive medians
            pd0 = Object.keys(state.forecasts).map((model) => {
                if (state.selected_models.includes(model)) {
                    const index = state.models.indexOf(model)
                    const model_forecasts = state.forecasts[model]
                    const date = model_forecasts.target_end_date
                    const lq1 = model_forecasts['q0.025']
                    const lq2 = model_forecasts['q0.25']
                    const mid = model_forecasts['q0.5']
                    const uq1 = model_forecasts['q0.75']
                    const uq2 = model_forecasts['q0.975']

                    // 1-3: sort model forecasts in order of target end date
                    // 1) combine the arrays:
                    const list = []
                    for (let j = 0; j < date.length; j++) {
                        list.push({
                            date: date[j],
                            lq1: lq1[j],
                            lq2: lq2[j],
                            uq1: uq1[j],
                            uq2: uq2[j],
                            mid: mid[j]
                        })
                    }

                    // 2) sort:
                    list.sort((a, b) => (moment(a.date).isBefore(b.date) ? -1 : 1))

                    // 3) separate them back out:
                    for (let k = 0; k < list.length; k++) {
                        model_forecasts.target_end_date[k] = list[k].date
                        model_forecasts['q0.025'][k] = list[k].lq1
                        model_forecasts['q0.25'][k] = list[k].lq2
                        model_forecasts['q0.5'][k] = list[k].mid
                        model_forecasts['q0.75'][k] = list[k].uq1
                        model_forecasts['q0.975'][k] = list[k].uq2
                    }

                    const x = [];
                    x.push(model_forecasts.target_end_date.slice(0)[0]);

                    const y = [];
                    y.push(model_forecasts['q0.5'].slice(0)[0]);

                    return {
                        x: x,
                        y: y,
                        mode: 'lines',
                        type: 'scatter',
                        name: model,
                        hovermode: false,
                        opacity: 0.7,
                        line: {color: state.colors[index]},
                        hoverinfo: 'none'
                    };
                }
                return []
            })
        }
        pd = pd0.concat(...pd)

        // add interval polygons
        let pd1 = []
        if (state.forecasts.length !== 0) {
            pd1 = Object.keys(state.forecasts).map((model) => {  // notes that state.forecasts are still sorted
                if (state.selected_models.includes(model)) {
                    const index = state.models.indexOf(model)
                    const is_hosp = state.selected_target_var === 'hosp'
                    const mode = is_hosp ? 'lines' : 'lines+markers'
                    const model_forecasts = state.forecasts[model]
                    let upper_quantile
                    let lower_quantile
                    const plot_line = {
                        // point forecast
                        x: model_forecasts.target_end_date,
                        y: model_forecasts['q0.5'],
                        type: 'scatter',
                        name: model,
                        opacity: 0.7,
                        mode,
                        line: {color: state.colors[index]}
                    }

                    if (state.selected_interval === '50%') {
                        lower_quantile = 'q0.25'
                        upper_quantile = 'q0.75'
                    } else if (state.selected_interval === '95%') {
                        lower_quantile = 'q0.025'
                        upper_quantile = 'q0.975'
                    } else {
                        return [plot_line]
                    }

                    const x = Object.keys(state.as_of_truth).length !== 0 ?
                        model_forecasts.target_end_date :
                        model_forecasts.target_end_date;
                    const y1 = Object.keys(state.as_of_truth).length !== 0 ?
                        model_forecasts[lower_quantile] :  // lower edge
                        model_forecasts[lower_quantile];
                    const y2 = Object.keys(state.as_of_truth).length !== 0 ?
                        model_forecasts[upper_quantile] :
                        model_forecasts[upper_quantile];  // upper edge
                    return [
                        plot_line,
                        {
                            // interval forecast -- currently fixed at 50%
                            x: [].concat(x, x.slice().reverse()),
                            y: [].concat(y1, y2.slice().reverse()),
                            fill: 'toself',
                            fillcolor: state.colors[index],
                            opacity: 0.3,
                            line: {color: 'transparent'},
                            type: 'scatter',
                            name: model,
                            showlegend: false,
                            hoverinfo: 'skip'
                        }
                    ]
                }
                return []
            })
        }
        pd = pd.concat(...pd1)

        // done!
        return pd
    },
};


export default App;  // export the module's main entry point