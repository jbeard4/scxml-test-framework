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
    GitHubApi = require("github"),
    // util = require('util'),
    // exec = require('child_process').exec,
    knownOpts = { 
        "parallel" : Boolean,
        "test-server-url" : String,
        "file-server-port" : Number,
        "file-server-host" : String,
        "verbose" : Boolean,
        "report" : Boolean,
        "issues" : Boolean
    },
    shortHands = { 
        "p" : "--parallel",
        "t" : "--test-server-url",
        "f" : "--file-server-port",
        "h" : "--file-server-host",
        "v" : "--verbose",
        "r" : "--report",
        "i" : "--issues"
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
var issues = parsed.issues;
var github;
var githubUser = "feyzo";
var githubRepo = "scion";
var githubToken = "";
var waitingForGithub = 0;
var allIssues = [];
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
            
            create_issue(pair, 'error', body, error);

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

            testResults.push({ name: testName, result: 'fail', error: e, data: body });

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

                if(verbose) {
                    console.log("sending event",event.event);
                }
                
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

    if(report) {
        generate_html_report(testResults, function () {
            // process.exit(testsFailed + testsErrored);
        });
    } else if(waitingForGithub == 0){
        // process.exit(testsFailed + testsErrored);
    }

}

function generate_html_report (results, report_done) {
    var all_html = "<!doctype html><html><body><h1>Test Results</h1>";

    all_html += "<h3>Summary</h3><p>NodeJs Version: " + process.version + " - " + new Date() + "<p>";

    all_html += "<p>Passed: " + testsPassed + ", Error: " + testsErrored + ", Failed: " + testsFailed + "</p>";

    all_html += "<h3>Tests</h3><table border='1'><tr><td>Name</td><td>Result</td><td>Error</td><td>Data</td></tr>";

    for (var i = testResults.length - 1; i >= 0; i--) {

        all_html += "<tr><td>" + testResults[i].name + "</td><td>" + testResults[i].result + "</td><td>" + testResults[i].error + "</td><td>" + JSON.stringify(testResults[i].data) + "</td></tr>";
        
    };

    all_html += "</body></html>";

    var date_filename = new Date().getTime();

    fs.writeFile("Report " + date_filename + ".html", all_html, function(err) {
        if(err) {
            console.log('Error creating report');
            console.log(err);
            report_done();
        } else {
            console.log("Report is created at /reports/" + date_filename);
            report_done();
        }
    }); 
}

function create_issue (testDetails, status, data, error) {
    if(issues) {
        var issueName = status + ' ' + testDetails[0];

        var prevIssue = _.find(allIssues, function(obj) { return obj.title === issueName });

        if(prevIssue) {
            //if issue is created
            if(prevIssue.state !== "open") {
                //If issue is closed
                github.issues.edit({
                    user: githubUser,
                    repo: githubRepo,
                    state: 'open',
                    number: prevIssue.number,
                    labels: [status, '2.0.0', 'Tests', 'node' + process.version],
                    assignee: 'feyzo'
                }, function (err, result) {
                    if(err) {
                        console.log('Error editing issue ' + issueName, err);
                    }
                    
                    console.log('Issue ' + issueName + ' is reopened.');

                    //Create comment with new findings
                });
            }
        } else {
            //if issue is not created
            console.log('not exists');
        }

    }

    // if(issues) {
    //     var issueName = status + ' ' + testDetails[0];
    //     if(allIssues.indexOf(issueName) == -1) {
    //         console.log('creating issue for ' + issueName);

    //         fs.readFile(testDetails[1], function (err, content) {
    //            //  content = content.toString().replace(/&/g, '&amp;')
    //            // .replace(/</g, '&lt;')
    //            // .replace(/>/g, '&gt;')
    //            // .replace(/"/g, '&quot;')
    //            // .replace(/'/g, '&apos;');
                

    //             var issueDesc = "[https://github.com/jbeard4/scxml-test-framework/tree/master/" + testDetails[0]
    //             + "](https://github.com/jbeard4/scxml-test-framework/tree/master/" + testDetails[0] + ")"
    //             + "\n**Error**: " + error
    //             + "\n**Data**: <code><pre>" + data + "</code></pre>"
    //             // + "\n**scxml**: <pre>" + content + "</pre>"
    //             + "\n**scxml**: \n```xml\n" + content + "\n```"
    //             + "\n**JSON**:  <code><pre>" + JSON.stringify(testDetails[2]) + "</code></pre>";

    //             console.log(issueDesc);

    //             // exec_bash('ghi open --claim -M 1 -L Tests -m "' + issueName + '\n' + issueDesc + '"', function () {
    //             //     console.log('issue created for ' + issueName);
    //             // });
    //         });


    //         // exec_bash('ghi open --claim -M 1 -L Tests -m "' + issueName + '\n' + issueDesc + '"', function () {
    //         //     console.log('issue created for ' + issueName);
    //         // });
    //     }
    //     // exec_bash('ghi list', function (result) {
    //     //     console.log('issue list');
    //     //     console.log(result);
    //     // });
    // }


    //exec_bash('ghi open --claim -M 1 -L Tests -m "Issue title\nDesc"', fun);
}

function exec_bash(command, callback){
    //flag for not quitting the process
    // waitingForGithub++;
    // exec(command, function(error, stdout, stderr) {
    //     if (error !== null) {
    //       console.log('exec error: ' + error);
    //     }

    //     //remove the flag
    //     waitingForGithub--;
    //     callback(stdout);
    // });
};

function start_tests () {
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
}

if(issues) {
    fs.readFile('.gittoken', function (err, content) {
        if(err) {
            console.log('Error reading github token. Create a file named .gittoken and put an oauth token', err);
            return;
        }

        githubToken = content.toString();

        github = new GitHubApi({
            version: "3.0.0",
            debug: true,
            protocol: "https",
            timeout: 5000
        });

        console.log(githubToken);

        github.authenticate({
            type: "oauth",
            token: githubToken
        });

        // Get all issues
        github.issues.repoIssues({state: 'all', user: githubUser, repo: githubRepo}, function (err, result) {
            if(err) {
                console.log('Error retrieving issues', err);
            }

            allIssues = result;

            console.log('Retrieved all issues');

            start_tests();
        });
    });
} else {
    start_tests();
}



