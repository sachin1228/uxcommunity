import React from 'react';
import { Platform, ScrollView, ScrollViewProps } from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

/**
 * The keyboard-aware scroll for form screens. Forwards its ref, so a submit
 * that fails can bring the error banner (at the top of the form) back into
 * view instead of leaving it off-screen above the button that was tapped.
 */
export const KeyboardAwareScrollViewCompat = React.forwardRef<ScrollView, Props>(
  function KeyboardAwareScrollViewCompat(
    { children, keyboardShouldPersistTaps = 'handled', ...props },
    ref,
  ) {
    if (Platform.OS === 'web') {
      return (
        <ScrollView
          ref={ref}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          {...props}
        >
          {children}
        </ScrollView>
      );
    }
    return (
      <KeyboardAwareScrollView
        ref={ref}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </KeyboardAwareScrollView>
    );
  },
);
