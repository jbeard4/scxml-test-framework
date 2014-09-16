//specify on the command-line tests to run...scxml files?

//read tests from filesystem

//run in two modes: parallel and serial

//specify test-server to communicate with

//client-server protocol:
//send sc to load; initial configuration returned in the response, along with id token. compare
//send event and id token; return new configuration; compare
//when done, send "done" event so server can optionally clean up.

//do the simplest thing first: run sequentially

var fs = require('fs'),
    path = require('path'),
    _ = require('underscore'),
    request = require('request'),
    assert = require('assert'),
    nopt = require('nopt'),
    Static = require('node-static'),
    http = require('http'),
    urlModule = require('url'),
    pathModule = require('path'),
    knownOpts = { 
        "parallel" : Boolean,
        "test-server-url" : String,
        "file-server-port" : Number,
        "file-server-host" : String,
        "verbose" : Boolean,
        "report" : Boolean
    },
    shortHands = { 
        "p" : "--parallel",
        "t" : "--test-server-url",
        "f" : "--file-server-port",
        "h" : "--file-server-host",
        "v" : "--verbose",
        "r" : "--report"
    },
    parsed = nopt(knownOpts, shortHands);

var fileServerPort = parsed['file-server-port'] || 9999,
    fileServerHost = parsed['file-server-host'] || 'localhost';

var cwd = process.cwd();

//start serving files
var file = new Static.Server(cwd);
var fileServer = http.createServer(function (request, response) {
    request.addListener('end', function () {
        file.serve(request, response);
    }).resume();
});
fileServer.listen(fileServerPort);
console.log('File server listing on ',fileServerPort);

//run tests
var url = parsed["test-server-url"] || "http://localhost:42000/";
var parallel = parsed.parallel;
var verbose = parsed.verbose;
var report = parsed.report;
var scxmlTestFiles = parsed.argv.remain;

//TODO: if scxmlTestFiles is empty, get all files ../test/*/*.scxml

var testJson = scxmlTestFiles.map(function(s){return path.join(path.dirname(s),path.basename(s,'.scxml') + '.json');}).
                map(function(f){return fs.readFileSync(f,'utf8');}).map(JSON.parse);
var testPairs = _.zip(scxmlTestFiles,scxmlTestFiles,testJson);

var testsPassed = 0, testsFailed = 0, testsErrored = 0, testResults = [];

function testPair(pair,done){
    var testName = pair[0], scxml = pair[1], testJson = pair[2], sessionToken, event;

    function handleResponse(error, response, body){
        if(error || response.statusCode !== 200){

            console.log("\x1b[31mError\x1b[0m:  " + testName);

            if(verbose) {
                console.error(error, body);
            }

            testResults.push({ name: testName, result: 'error', error: error, data: body });
            
            testsErrored++; 
            done();
            return;
        }

        try{
            assert.deepEqual(
                body.nextConfiguration.sort(),
                ( ((typeof sessionToken !== 'undefined') && event) ? event.nextConfiguration : testJson.initialConfiguration).sort());
        }catch(e){
            console.log("\x1b[35mFailed\x1b[0m: " + testName);

            if(verbose) {
                console.error(e);
            }

            testsFailed++;

            testResults.push({ name: testName, result: 'fail', error: error, data: body });

            done();
            return;
        }

        if((typeof body.sessionToken !== 'undefined') && (typeof sessionToken === 'undefined')){
            sessionToken = body.sessionToken;   //we send this along with all subsequent requests
        }

        sendEvent();
    }

    //send scxml
    var loadUrl = urlModule.format({
        protocol : 'http:',
        hostname : fileServerHost,
        port:fileServerPort,
        pathname : scxml
    });

    if(verbose) {
        console.log("loading",testName,loadUrl);
    }

    request.post( { 
        url : url, 
        json : { 
            load : loadUrl 
        } 
    }, handleResponse);

    //send events until there are no more events
    function sendEvent(){
        event = testJson.events.shift();
        if(event){
            function doSend(){

                console.log("sending event",event.event);
                
                request.post(
                    {
                        url : url,
                        json : {
                            event : event.event,
                            sessionToken : sessionToken 
                        }
                    },
                    handleResponse);
            }

            if(event.after){
                console.log("waiting to send",event.after);
                setTimeout(doSend,event.after);
            }else{
                doSend();
            }
        }else{
            console.log("\x1b[32mPassed\x1b[0m: " + testName);

            testsPassed++;

            testResults.push({ name: testName, result: 'pass', error: null, data: null });

            done();
        }
    }
}

function complete(){
    //stop serving files
    fileServer.close();

    //print summary
    console.log("TEST RESULTS");
    console.log("\x1b[32mPassed: " + testsPassed + "\x1b[0m, \x1b[31mError: " + testsErrored + "\x1b[0m, \x1b[35mFailed: " + testsFailed + "\x1b[0m");


    if(verbose) {
        //Print all test results
    }

    if(report) {
        //generate html result file
    }

    process.exit(testsFailed + testsErrored);
}

if(parallel){
    //run in parallel
    function done(){
        if((testResults.length) === scxmlTestFiles.length) complete();
    }
    testPairs.forEach(function(pair){testPair(pair,done);});
}else{
    //run sequentially
    (function(pair){
        if(pair){
            var f = arguments.callee;
            var nextStep = function(){ f(testPairs.pop()); };
            testPair(pair,nextStep); 
        }else{
            //we're done
            complete();
        }
    })(testPairs.pop());
}

