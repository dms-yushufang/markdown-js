/**
 Tasks cribbed from jQuery to handle building custom markdown parsers.

*/

module.exports = function( grunt ) {

  "use strict";

  var fs = require( "fs" ),
    srcFolder = __dirname + "/../../src/",
    rdefineEnd = /\}\);[^}\w]*$/,
    // This is temporary until the skipSemiColonInsertion option makes it to NPM
    requirejs = require( "requirejs" ),
    config = {
      baseUrl: "src",
      name: "markdown",
      // We have multiple minify steps
      optimize: "none",
      skipSemiColonInsertion: true,
      onBuildWrite: convert
    };

  /**
   * Strip all definitions generated by requirejs
   * Convert "var" modules to var declarations
   * "var module" means the module only contains a return statement that should be converted to a var declaration
   * This is indicated by including the file in any "var" folder
   * @param {String} name
   * @param {String} path
   * @param {String} contents The contents to be written (including their AMD wrappers)
   */
  function convert( name, path, contents ) {
    // Convert var modules
    if ( /.\/var\//.test( path ) ) {
      contents = contents
        .replace( /define\([\w\W]*?return/, "var " + (/var\/([\w-]+)/.exec(name)[1]) + " =" )
        .replace( rdefineEnd, "" );

    } else {

      contents = contents
        .replace( /\s*return\s+[^\}]+(\}\);[^\w\}]*)$/, "$1" );

      // Remove define wrappers, closure ends, and empty declarations
      contents = contents
        .replace( /define\([^{]*?{/, "" )
        .replace( rdefineEnd, "" );

      // Remove empty definitions
      contents = contents
        .replace( /define\(\[[^\]]+\]\)[\W\n]+$/, "" );
    }
    return contents;
  }

  grunt.registerMultiTask(
    "build",
    "Concatenate source, remove sub AMD definitions, (include/exclude modules with +/- flags), embed date/version",
  function() {
    var flag, index,
      done = this.async(),
      flags = this.flags,
      name = this.data.dest,
      minimum = this.data.minimum,
      removeWith = this.data.removeWith,
      excluded = [],
      included = [],
      version = grunt.config( "pkg.version" ),
      /**
       * Recursively calls the excluder to remove on all modules in the list
       * @param {Array} list
       * @param {String} [prepend] Prepend this to the module name. Indicates we're walking a directory
       */
      excludeList = function( list, prepend ) {
        if ( list ) {
          prepend = prepend ? prepend + "/" : "";
          list.forEach(function( module ) {
            // Exclude var modules as well
            if ( module === "var" ) {
              excludeList( fs.readdirSync( srcFolder + prepend + module ), prepend + module );
              return;
            }
            if ( prepend ) {
              // Skip if this is not a js file and we're walking files in a dir
              if ( !(module = /([\w-\/]+)\.js$/.exec( module )) ) {
                return;
              }
              // Prepend folder name if passed
              // Remove .js extension
              module = prepend + module[1];
            }

            // Avoid infinite recursion
            if ( excluded.indexOf( module ) === -1 ) {
              excluder( "-" + module );
            }
          });
        }
      },
      /**
       * Adds the specified module to the excluded or included list, depending on the flag
       * @param {String} flag A module path relative to the src directory starting with + or - to indicate whether it should included or excluded
       */
      excluder = function( flag ) {
        var m = /^(\+|\-|)([\w\/-]+)$/.exec( flag ),
          exclude = m[ 1 ] === "-",
          module = m[ 2 ];

        if ( exclude ) {
          // Can't exclude certain modules
          if ( minimum.indexOf( module ) === -1 ) {
            // Add to excluded
            if ( excluded.indexOf( module ) === -1 ) {
              grunt.log.writeln( flag );
              excluded.push( module );
              // Exclude all files in the folder of the same name
              // These are the removable dependencies
              // It's fine if the directory is not there
              try {
                excludeList( fs.readdirSync( srcFolder + module ), module );
              } catch( e ) {
                grunt.verbose.writeln( e );
              }
            }
            // Check removeWith list
            excludeList( removeWith[ module ] );
          } else {
            grunt.log.error( "Module \"" + module + "\" is a mimimum requirement.");
            if ( module === "selector" ) {
              grunt.log.error( "If you meant to replace Sizzle, use -sizzle instead." );
            }
          }
        } else {
          grunt.log.writeln( flag );
          included.push( module );
        }
      };

    // append commit id to version
    if ( process.env.COMMIT ) {
      version += " " + process.env.COMMIT;
    }

    // figure out which files to exclude based on these rules in this order:
    //  dependency explicit exclude
    //  > explicit exclude
    //  > explicit include
    //  > dependency implicit exclude
    //  > implicit exclude
    // examples:
    //  *                  none (implicit exclude)
    //  *:*                all (implicit include)
    //  *:*:-css           all except css and dependents (explicit > implicit)
    //  *:*:-css:+effects  same (excludes effects because explicit include is trumped by explicit exclude of dependency)
    //  *:+effects         none except effects and its dependencies (explicit include trumps implicit exclude of dependency)
    for ( flag in flags ) {
      if ( flag !== "*" ) {
        excluder( flag );
      }
    }
    grunt.verbose.writeflags( excluded, "Excluded" );
    grunt.verbose.writeflags( included, "Included" );

    // append excluded modules to version
    if ( excluded.length ) {
      version += " -" + excluded.join( ",-" );
      // set pkg.version to version with excludes, so minified file picks it up
      grunt.config.set( "pkg.version", version );
      grunt.verbose.writeln( "Version changed to " + version );
      // Have to use shallow or core will get excluded since it is a dependency
      config.excludeShallow = excluded;
    }
    config.include = included;

    config.wrap = {
      startFile: this.data.startFile,
      endFile: this.data.endFile
    };


    /**
     * Handle Final output from the optimizer
     * @param {String} compiled
     */
    config.out = function( compiled ) {
      compiled = compiled
        // Embed Version
        .replace( /@VERSION/g, version )
        // Embed Date
        // yyyy-mm-ddThh:mmZ
        .replace( /@DATE/g, ( new Date() ).toISOString().replace( /:\d+\.\d+Z$/, "Z" ) );

      // Write concatenated source to file
      grunt.file.write( name, compiled );
    };

    // Trace dependencies and concatenate files
    requirejs.optimize( config, function( response ) {
      grunt.verbose.writeln( response );
      grunt.log.ok( "File '" + name + "' created." );
      done();
    }, function( err ) {
      done( err );
    });
  });

  // Special "alias" task to make custom build creation less grawlix-y
  // Translation example
  //
  //   grunt custom:+ajax,-dimensions,-effects,-offset
  //
  // Becomes:
  //
  //   grunt build:*:*:+ajax:-dimensions:-effects:-offset
  grunt.registerTask( "custom", function() {
    var args = [].slice.call( arguments ),
      modules = args.length ? args[ 0 ].replace( /,/g, ":" ) : "";

    grunt.log.writeln( "Creating custom build...\n" );

    grunt.task.run([ "build:*:*:" + modules, 'uglify']);
  });
};
