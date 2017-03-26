/*
 * Server receive ~ 20K requests per second. Response timeout is 19000ms.
 * Stats collector should calculate the median and average request response times for a 7 day dataset.
 */
'use strict';

class StatsCollector {
  constructor() {
    this.timeout = 19000;
    this.today = (new Date()).toDateString();
    this.newDay = {
      date: this.today,
      average: 0,
      counter: 0,
      errors: 0,
      median: {}
    };
    for (let i = 1; i < this.timeout; i++) {
      this.newDay.median[i] = 0;
    }
    this.weekData = [this.newDay];
    this.collectorSize = 0;
    this.isNumeric = n => /^-{0,1}\d*\.{0,1}\d+$/.test(n) && Number.isInteger(n);
    this.getWeightedMean = (counter, newValue) => ((counter - 1) * this.weekData[0].average + newValue ) / counter;
  }

  pushValue(responseTimeMs) {
    const valid = this.isNumeric(responseTimeMs) && responseTimeMs > 0 && responseTimeMs < this.timeout;
    if (!valid) {
      this.weekData[0].errors += 1;
      return 'Value is not valid';
    }
    if (this.today != this.weekData[0].date) {
      if (this.weekData.length == 7) {
        this.collectorSize = this.collectorSize - this.weekData[this.weekData.length - 1].counter;
        this.weekData.pop();
      }
      this.weekData.unshift(this.newDay);
    }
    this.collectorSize += 1;
    this.weekData[0].counter += 1;
    this.weekData[0].average = this.getWeightedMean(this.weekData[0].counter, responseTimeMs);
    this.weekData[0].median[responseTimeMs] += 1;
    return;
  }

  get median() {
    let median = 0;
    if (this.collectorSize > 0) {
      const collectorDataCounters = {};
      this.weekData.forEach(day => {
        for (let key in day.median) {
          if (day.median[key] > 0) {
            if (!collectorDataCounters.hasOwnProperty(key)) collectorDataCounters[key] = 0;
            collectorDataCounters[key] += day.median[key];
          }
        }
      });

      const odd = (this.collectorSize % 2 === 1);
      const collectorMid = odd ? (this.collectorSize + 1) / 2 : this.collectorSize / 2 + 1;

      let currentAmount = 0;
      let previousResponseTime = 0;
      let ResponseTime;
      let jump;

      for (let key in collectorDataCounters) {
        ResponseTime = parseInt(key);
        currentAmount += collectorDataCounters[key];
        jump = currentAmount - collectorMid;
        if (currentAmount >= collectorMid) {
          if (collectorDataCounters[key] - jump > 1) {
            return ResponseTime;
          }
          return odd ? ResponseTime : (ResponseTime + previousResponseTime) / 2;
        }
        previousResponseTime = ResponseTime;
      }
      return 'something went wrong';
    } else {
      return median;
    }
  }

  get average() {
    let sum = 0;
    this.weekData.forEach(day => {
      sum += day.average;
    });
    return Math.round(sum / this.weekData.length);
  }

  //methods for testing purposes
  fillWeekData(daysData, collectorSize) {
    this.weekData = daysData;
    this.collectorSize = collectorSize || this.collectorSize;
  }

  get data() {
    return this.weekData;
  }

  get errorsCount() {
    return this.weekData[0].errors;
  }
}

mocha.setup("bdd");
chai.should();

describe('StatsCollector', function () {

  let statistics;
  const historyDepth = 7;
  const requestTimeout = 18999;
  const today = (new Date(Date.now())).toDateString();
  const yesterday = (new Date(Date.now() - 864e5)).toDateString();
  let median = {};


  for (let i = 1; i < 19000; i++) {
    median[i] = 0;
  }

  beforeEach(function newCollector() {
    statistics = new StatsCollector();
  });

  it('should have initial state', function () {
    const collectorData = statistics.data;
    collectorData.should.deep.equal([{
      date: today,
      average: 0,
      median: median,
      counter: 0,
      errors: 0
    }]);
    statistics.average.should.equal(0);
    statistics.median.should.equal(0);
  });

  describe('pushValue', function () {

    it('should accept max value and save correct data', function () {
      let maxValue = requestTimeout;
      statistics.pushValue(maxValue);
      const collectorData = statistics.data;
      collectorData[0].date.should.equal(today);
      collectorData[0].average.should.equal(maxValue);
      collectorData[0].median[maxValue].should.equal(1);
      collectorData[0].counter.should.equal(1);
      collectorData[0].errors.should.equal(0);
    });

    it('should accept minimum value 1 and return the same average', function () {
      statistics.pushValue(1);
      statistics.average.should.equal(1);
    });

    const errorHandlingTestCases = [
      {value: '10000', string: 'string "10000"'},
      {value: NaN, string: 'NaN'},
      {value: undefined},
      {value: null},
      {value: true},
      {value: {}, string: 'object {}'},
      {value: [10000], string: 'array [10000]'},
      {value: '', string: 'empty string'},
      {value: '\n', string: '\n'},
      {value: '2e2'},
      {value: '0x1FA'},
      {value: new Number(123), string: 'new Number(123)'},
      {value: 2e-4},
      {value: 0.01},
      {value: 1 / 0},
      {value: -42 / +0},
      {value: 0},
      {value: 19000},
      {value: -1000},
      {value: 2e12}
    ];

    errorHandlingTestCases.forEach(test => {
      const testValueRepresentation = test.string ? test.string : String(test.value);
      it('should increment error counter when ' + testValueRepresentation + ' is pushed and keep average = 0', function () {
        (() => statistics.pushValue(test.value)).should.not.throw(Error);
        statistics.average.should.equal(0);
        statistics.errorsCount.should.equal(1);
      });
    });

    describe('start new day', function () {

      const testData = {
        date: yesterday,
        average: 0,
        counter: 0,
        errors: 0
      };
      const value = 10000;

      beforeEach(function () {
        statistics.fillWeekData([testData]);
        statistics.pushValue(value);
      });

      it('should start a new day in collector', function () {
        const collectorData = statistics.data;
        collectorData.length.should.equal(2);
        collectorData[1].should.deep.equal(testData);
        collectorData[0].median[value].should.equal(1);
        collectorData[0].counter.should.equal(1);
        collectorData[0].average.should.equal(value);
        collectorData[0].date.should.equal(today);
      });
    });

    describe('remove 8th day', function () {

      let testData = [];
      let seventhDayAverage = 0;
      let sixthDayAverage = 0;
      let value = 0;
      let sum = 0;

      beforeEach(function () {
        for (let i = 0; i < 7; i += 1) {
          value = Math.floor(Math.random() * requestTimeout) + 1;
          sum = sum + value;
          testData.push({average: value});
        }
        testData[0].date = yesterday;
        seventhDayAverage = testData[6].average;
        sixthDayAverage = testData[5].average;
        statistics.fillWeekData(testData);
        statistics.pushValue(10000);
        statistics.pushValue(20000);
        statistics.pushValue(15000);
      });

      it('should remove data older than 7 days and return correct average for last 7 days', function () {
        const collectorData = statistics.data;
        const expectedAverage = Math.round((sum - seventhDayAverage + (10000 + 15000) / 2) / 7);
        collectorData.length.should.equal(historyDepth);
        collectorData[collectorData.length - 1].average.should.equal(sixthDayAverage);
        statistics.average.should.equal(expectedAverage);
      });
    });
  });

  describe('get average', function () {

    it('should return correct average for 2 values (single push already tested)', function () {
      statistics.pushValue(10);
      statistics.pushValue(100);
      statistics.average.should.equal((10 + 100) / 2);
    });

    it('should return correct average for 20000 values within 1 second', function () {
      this.timeout(1000);
      const statistics1 = new StatsCollector();
      const amount = 20000;
      let value = 0;
      let sum = 0;
      for (let i = 0; i < amount; i += 1) {
        value = Math.floor(Math.random() * requestTimeout) + 1;
        sum = sum + value;
        statistics1.pushValue(value);
      }
      statistics1.average.should.equal(Math.round(sum / amount));
    });

    it('should return correct average for 7 days', function () {
      let value = 0;
      let sum = 0;
      let testData = [];
      for (let i = 0; i < 7; i += 1) {
        value = Math.floor(Math.random() * requestTimeout) + 1;
        sum = sum + value;
        testData.push({average: value});
      }
      statistics.fillWeekData(testData);
      statistics.average.should.equal(Math.round(sum / 7));
    });

    it('should return correct average for 2 days', function () {
      statistics.fillWeekData([{
        date: yesterday,
        average: 1000
      }]);
      statistics.pushValue(10);
      statistics.pushValue(100);
      statistics.average.should.equal(Math.round(((10 + 100) / 2 + 1000) / 2));
    });
  });

  describe('get median', function () {

    const getMedian = (values) => {
      values.sort(function (a, b) {
        return a - b;
      });

      var half = Math.floor(values.length / 2);

      if (values.length % 2)
        return values[half];
      else
        return (values[half - 1] + values[half]) / 2.0;
    };

    it('should return median for single value in collector', function () {
      statistics.pushValue(1);
      const median = statistics.median;
      median.should.equal(getMedian([1]));
    });

    it('should return median for 2 values in collector', function () {
      statistics.pushValue(1);
      statistics.pushValue(10);
      const median = statistics.median;
      median.should.equal(getMedian([1, 10]));
    });

    it('should return median for 3 values in collector', function () {
      statistics.pushValue(1);
      statistics.pushValue(10);
      statistics.pushValue(100);
      const median = statistics.median;
      median.should.equal(getMedian([1, 10, 100]));
    });

    it('should return median for 20000 values within 1 second', function () {
      this.timeout(1000);
      const amount = 20000;
      let inputData = [];
      let value = 0;
      let sum = 0;
      for (let i = 0; i < amount; i += 1) {
        value = Math.floor(Math.random() * requestTimeout) + 1;
        sum = sum + value;
        inputData.push(value);
        statistics.pushValue(value);
      }
      const median = statistics.median;
      const expectedMedian = getMedian(inputData);
      median.should.equal(expectedMedian);
    });

    describe('1 day data set', function () {

      let value = 0;
      let dayDataCounter = 0;
      let dayData;
      let weekData = [];
      let allData = [];
      let expectedMedian;

      beforeEach(function () {
        dayData = {};
        dayDataCounter = 0;
        for (let j = 1; j < 5; j += 1) {
          value = Math.floor(Math.random() * requestTimeout) + 1;
          for (let k = 0; k < value; k += 1) {
            allData.push(j);
          }
          dayData[j] = value;
          dayDataCounter += value;
        }
        weekData[0] = {date: yesterday, counter: dayDataCounter, median: dayData};
        statistics.fillWeekData(weekData, dayDataCounter);
        statistics.pushValue(requestTimeout);
        statistics.pushValue(requestTimeout);
        statistics.pushValue(requestTimeout);
        allData.push(requestTimeout);
        allData.push(requestTimeout);
        allData.push(requestTimeout);
      });

      it('should start new day and return median for last 7 days when first values pushed in new day', function () {
        expectedMedian = getMedian(allData);
        const median = statistics.median;
        median.should.equal(expectedMedian);
      });
    });

    describe('7 days data set', function () {

      let value = 0;
      let weekDataCounter = 0;
      let dayData;
      let weekData = [];
      let allData = [];
      let expectedMedian;

      beforeEach(function () {
        for (let i = 0; i < 7; i += 1) {
          dayData = {};
          for (let j = 500; j < 1000; j += 1) {
            value = Math.floor(Math.random() * 600) + 1;
            weekDataCounter += value;
            dayData[j] = value;
            for (let k = 0; k < value; k += 1) {
              allData.push(j);
            }
          }
          weekData.push({median: dayData});
        }
        weekData[0].date = today;
        weekData[1].date = yesterday;
        statistics.fillWeekData(weekData, weekDataCounter);
        expectedMedian = getMedian(allData);
      });

      it('should return median for 7 days ', function () {
        const median = statistics.median;
        median.should.equal(expectedMedian);
      });
    });

    describe('7 days +1 data set', function () {

      let value = 0;
      let weekDataCounter = 0;
      let dayDataCounter = 0;
      let dayData;
      let weekData = [];
      let allData = [];
      let expectedMedian;

      beforeEach(function () {
        for (let i = 0; i < 7; i += 1) {
          dayData = {};
          dayDataCounter = 0;
          for (let j = 1; j < 50; j += 1) {
            value = Math.floor(Math.random() * requestTimeout) + 1;
            if (i < 6) {
              for (let k = 0; k < value; k += 1) {
                allData.push(j);
              }
            }
            weekDataCounter += value;
            dayData[j] = value;
            dayDataCounter += value;
          }
          weekData.push({date: yesterday, counter: dayDataCounter, median: dayData});
        }
        statistics.fillWeekData(weekData, weekDataCounter);
        statistics.pushValue(requestTimeout);
        statistics.pushValue(requestTimeout);
        statistics.pushValue(requestTimeout);
        allData.push(requestTimeout);
        allData.push(requestTimeout);
        allData.push(requestTimeout);
      });

      it('should start new day and return median for last 7 days when first values pushed in new day', function () {
        expectedMedian = getMedian(allData);
        const median = statistics.median;
        median.should.equal(expectedMedian);
      });
    });
  });
});

// Run all our test suites.  Only necessary in the browser.
mocha.run();
