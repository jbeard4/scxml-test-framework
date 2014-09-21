var fs = require('fs'),
    _ = require('underscore'),
    GitHubApi = require("github");


var github,
    githubUser = "feyzo",
    githubRepo = "scion",
    githubAssignee = "feyzo",
    allIssues;

var issueHandler = {
    getIssues: function(callback) {
        fs.readFile('.gittoken', function (err, token) {
            if(err) {
                console.log('Error reading github token. Create a file named .gittoken and put an oauth token', err);
                return;
            }

            github = new GitHubApi({
                version: "3.0.0",
                protocol: "https",
                timeout: 5000
            });

            github.authenticate({
                type: "oauth",
                token: token
            });

            // Get all issues
            github.issues.repoIssues({
                state: 'all',
                user: githubUser,
                repo: githubRepo
            }, function (err, result) {
                if(err) {
                    console.log('Error retrieving issues', err);
                }

                console.log('Retrieved all issues');

                allIssues = result;
                
                callback(result);
            });
        });
    },
    createBody: function (testDetails, status, data, error, callback) {
        fs.readFile(testDetails[1], function (err, fileContent) {
            //Read scxml file

            var issueDesc = "[https://github.com/jbeard4/scxml-test-framework/tree/master/" + testDetails[0]
            + "](https://github.com/jbeard4/scxml-test-framework/tree/master/" + testDetails[0] + ")"
            + "\n\n**Error** <code><pre>" + JSON.stringify(error, undefined, 2) + "</code></pre>"
            + "\n**Data**: <code><pre>" + JSON.stringify(data, undefined, 2) + "</code></pre>"
            + "\n**scxml**: \n```xml\n" + fileContent + "\n```"
            + "\n**JSON**:  <code><pre>" + JSON.stringify(testDetails[2], undefined, 2) + "</code></pre>";

            callback(issueDesc);
        });
    },
    createIssue: function (testDetails, status, data, error) {
        var issueName = status + ' ' + testDetails[0];
        var issueBody = "";

        this.createBody(testDetails, status, data, error, function (issueContent) {
            issueBody = issueContent;

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
                        labels: [status, '2.0.0', 'Tests', 'Node ' + process.version],
                        assignee: githubAssignee
                    }, function (err, result) {
                        if(err) {
                            console.log('Error editing issue ' + issueName, err);
                            return;
                        }
                        
                        console.log('Issue ' + issueName + ' is reopened.');

                        github.issues.createComment({
                            user: githubUser,
                            repo: githubRepo,
                            number: prevIssue.number,
                            body: issueBody
                        }, function (err, result) {
                            if(err) {
                                console.log('Error adding comment on ' + issueName, err);
                                return;
                            }
                            
                            console.log('Details added to comment on ' + issueName);
                        });
                    });
                }
            } else {
                //if issue is not created
                github.issues.create({
                    user: githubUser,
                    repo: githubRepo,
                    title: issueName,
                    body: issueBody,
                    labels: [status, '2.0.0', 'Tests', 'Node ' + process.version],
                    assignee: githubAssignee
                }, function (err, result) {
                    if(err) {
                        console.log('Error creating issue ' + issueName, err);
                        return;
                    }
                    
                    console.log('Issue ' + issueName + ' created.');
                });
            }
        });
    }
};

exports.issueHandler = issueHandler;

