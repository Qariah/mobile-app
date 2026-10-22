Pod::Spec.new do |s|
  s.name           = 'RotationStage'
  s.version        = '1.0.0'
  s.summary        = 'Keeps the Mushaf page coherent while iOS rotates the interface'
  s.description    = 'A container view that animates its content in step with the UIKit rotation transition'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
